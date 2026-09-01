import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { PublicUser, User } from "../types.js";
import { Errors } from "./errors.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { logAction } from "./auditLog.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_PASSWORD_LENGTH = 8;

function toPublicUser(user: User): PublicUser {
  const { passwordHash, ...rest } = user;
  return rest;
}

function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function getUserByEmail(db: DatabaseSync, email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

function getUserById(db: DatabaseSync, id: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

function createSession(db: DatabaseSync, userId: string): string {
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare("INSERT INTO sessions (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)").run(
    token,
    userId,
    expiresAt.toISOString(),
    now.toISOString()
  );
  return token;
}

function validatePasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw Errors.weakPassword();
}

export async function signup(
  db: DatabaseSync,
  input: { name: unknown; email: unknown; password: unknown; confirmPassword: unknown }
): Promise<{ user: PublicUser; token: string }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  if (!name) throw Errors.invalidInput("Name is required.");
  if (!email || !EMAIL_RE.test(email)) throw Errors.invalidInput("A valid email is required.");
  validatePasswordPolicy(password);
  if (password !== confirmPassword) throw Errors.passwordMismatch();

  // Case-insensitive uniqueness: email is normalized to lowercase before
  // every lookup/insert, so "John@x.com" and "john@x.com" always collide
  // against the same stored (lowercase) row and the UNIQUE constraint below
  // is enforced on that normalized form.
  if (getUserByEmail(db, email)) throw Errors.emailTaken();

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, name, email, passwordHash, role, status, passwordChangeRequired, lastLoginAt, createdAt)
     VALUES (@id, @name, @email, @passwordHash, 'USER', 'ACTIVE', 0, NULL, @createdAt)`
  ).run({ id, name, email, passwordHash, createdAt });

  logAction(db, { actorId: id, actorEmail: email, action: "USER_REGISTERED", entityType: "user", entityId: id });

  const token = createSession(db, id);
  const user: User = {
    id,
    name,
    email,
    passwordHash,
    role: "USER",
    status: "ACTIVE",
    passwordChangeRequired: 0,
    lastLoginAt: null,
    createdAt
  };
  return { user: toPublicUser(user), token };
}

export async function login(
  db: DatabaseSync,
  input: { email: unknown; password: unknown }
): Promise<{ user: PublicUser; token: string }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  if (!email || !password) throw Errors.invalidCredentials();

  const user = getUserByEmail(db, email);
  if (!user) {
    logAction(db, { actorEmail: email, action: "LOGIN_FAILED", details: { reason: "no such account" } });
    throw Errors.invalidCredentials();
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    logAction(db, { actorId: user.id, actorEmail: email, action: "LOGIN_FAILED", details: { reason: "wrong password" } });
    throw Errors.invalidCredentials();
  }

  if (user.status !== "ACTIVE") {
    logAction(db, { actorId: user.id, actorEmail: email, action: "LOGIN_BLOCKED_INACTIVE" });
    throw Errors.accountInactive();
  }

  const lastLoginAt = new Date().toISOString();
  db.prepare("UPDATE users SET lastLoginAt = ? WHERE id = ?").run(lastLoginAt, user.id);
  logAction(db, { actorId: user.id, actorEmail: email, action: "LOGIN_SUCCESS" });

  const token = createSession(db, user.id);
  return { user: toPublicUser({ ...user, lastLoginAt }), token };
}

export function logout(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/**
 * Resolves a bearer token to its user. Returns undefined for an unknown,
 * expired, or (if the account has since been deactivated) inactive user —
 * role/status are re-checked on every request, not just cached from login.
 */
export function getUserByToken(db: DatabaseSync, token: string): PublicUser | undefined {
  const row = db
    .prepare(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.userId
       WHERE sessions.token = ?`
    )
    .get(token) as (User & { expiresAt?: string }) | undefined;
  if (!row) return undefined;

  const session = db.prepare("SELECT expiresAt FROM sessions WHERE token = ?").get(token) as
    | { expiresAt: string }
    | undefined;
  if (session && new Date(session.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return undefined;
  }

  if (row.status !== "ACTIVE") return undefined;

  return toPublicUser(row);
}

export function getPublicUserById(db: DatabaseSync, id: string): PublicUser | undefined {
  const user = getUserById(db, id);
  return user ? toPublicUser(user) : undefined;
}

export async function changePassword(
  db: DatabaseSync,
  userId: string,
  input: { currentPassword: unknown; newPassword: unknown; confirmPassword: unknown; name?: unknown; email?: unknown }
): Promise<PublicUser> {
  const user = getUserById(db, userId);
  if (!user) throw Errors.notFound("User");

  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw Errors.incorrectPassword();

  validatePasswordPolicy(newPassword);
  if (newPassword !== confirmPassword) throw Errors.passwordMismatch();

  let name = user.name;
  let email = user.email;

  // On the forced first-login change, the default admin also claims their
  // own name + email here, so every later login uses their own identity
  // (email + the password they just set) instead of the shared default
  // admin@gmail.com account. Required only in this forced case — a regular
  // "change my password" call doesn't touch profile fields.
  if (user.passwordChangeRequired) {
    const inputName = typeof input.name === "string" ? input.name.trim() : "";
    const inputEmail = normalizeEmail(input.email);
    if (!inputName) throw Errors.invalidInput("Name is required.");
    if (!inputEmail || !EMAIL_RE.test(inputEmail)) throw Errors.invalidInput("A valid email is required.");
    if (inputEmail !== user.email) {
      const existing = getUserByEmail(db, inputEmail);
      if (existing && existing.id !== userId) throw Errors.emailTaken();
    }
    name = inputName;
    email = inputEmail;
  }

  const passwordHash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET name = ?, email = ?, passwordHash = ?, passwordChangeRequired = 0 WHERE id = ?").run(
    name,
    email,
    passwordHash,
    userId
  );
  logAction(db, { actorId: userId, actorEmail: email, action: "PASSWORD_CHANGED", entityType: "user", entityId: userId });

  return toPublicUser({ ...user, name, email, passwordHash, passwordChangeRequired: 0 });
}

/**
 * Always resolves the same way whether or not the email exists, so the
 * caller (route layer) can return one generic response and never let an
 * attacker distinguish "no such account" from "reset link sent" (no user
 * enumeration). A token row is only actually created when the user exists.
 *
 * No email provider is configured in this project — the reset link is
 * logged to the server console instead. See DEPLOY.md / README for what a
 * real deployment needs to wire up here (e.g. an SMTP or transactional
 * email provider) instead of console.log.
 */
export async function requestPasswordReset(db: DatabaseSync, emailInput: unknown): Promise<void> {
  const email = normalizeEmail(emailInput);
  if (!email) return;

  const user = getUserByEmail(db, email);
  if (!user) return;

  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);

  db.prepare("INSERT INTO password_resets (token, userId, expiresAt, usedAt, createdAt) VALUES (?, ?, ?, NULL, ?)").run(
    token,
    user.id,
    expiresAt.toISOString(),
    now.toISOString()
  );

  logAction(db, {
    actorId: user.id,
    actorEmail: user.email,
    action: "PASSWORD_RESET_REQUESTED",
    entityType: "user",
    entityId: user.id
  });

  // No email provider configured — this is the "send the email" substitute.
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  console.log(
    `[password reset] ${user.email} -> ${frontendUrl}/reset-password?token=${token} (expires ${expiresAt.toISOString()})`
  );
}

export async function resetPassword(
  db: DatabaseSync,
  input: { token: unknown; newPassword: unknown; confirmPassword: unknown }
): Promise<void> {
  const token = typeof input.token === "string" ? input.token : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  if (!token) throw Errors.invalidOrExpiredToken();

  const reset = db.prepare("SELECT * FROM password_resets WHERE token = ?").get(token) as
    | { token: string; userId: string; expiresAt: string; usedAt: string | null }
    | undefined;

  if (!reset || reset.usedAt || new Date(reset.expiresAt).getTime() < Date.now()) {
    throw Errors.invalidOrExpiredToken();
  }

  validatePasswordPolicy(newPassword);
  if (newPassword !== confirmPassword) throw Errors.passwordMismatch();

  const user = getUserById(db, reset.userId);
  if (!user) throw Errors.invalidOrExpiredToken();

  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET passwordHash = ? WHERE id = ?").run(passwordHash, user.id);
  db.prepare("UPDATE password_resets SET usedAt = ? WHERE token = ?").run(now, token);

  logAction(db, {
    actorId: user.id,
    actorEmail: user.email,
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "user",
    entityId: user.id
  });
}

const DEFAULT_ADMIN_EMAIL = "admin@gmail.com";
const DEFAULT_ADMIN_PASSWORD = "admin@password";

/** Idempotent: creates the default admin account once, on first boot. */
export async function ensureDefaultAdmin(db: DatabaseSync): Promise<void> {
  const existing = getUserByEmail(db, DEFAULT_ADMIN_EMAIL);
  if (existing) return;

  const id = randomUUID();
  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, name, email, passwordHash, role, status, passwordChangeRequired, lastLoginAt, createdAt)
     VALUES (@id, 'Admin', @email, @passwordHash, 'ADMIN', 'ACTIVE', 1, NULL, @createdAt)`
  ).run({ id, email: DEFAULT_ADMIN_EMAIL, passwordHash, createdAt });

  logAction(db, { actorId: id, actorEmail: DEFAULT_ADMIN_EMAIL, action: "DEFAULT_ADMIN_CREATED", entityType: "user", entityId: id });
  console.log(`Default admin created: ${DEFAULT_ADMIN_EMAIL} (password change required on first login)`);
}
