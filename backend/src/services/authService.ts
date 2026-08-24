import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { PublicUser, User } from "../types.js";
import { Errors } from "./errors.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  db.prepare("INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)").run(
    token,
    userId,
    new Date().toISOString()
  );
  return token;
}

export async function signup(
  db: DatabaseSync,
  input: { name: unknown; email: unknown; password: unknown }
): Promise<{ user: PublicUser; token: string }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  if (!name) throw Errors.invalidInput("Name is required.");
  if (!email || !EMAIL_RE.test(email)) throw Errors.invalidInput("A valid email is required.");
  if (password.length < 8) throw Errors.weakPassword();

  if (getUserByEmail(db, email)) throw Errors.emailTaken();

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  db.prepare(
    "INSERT INTO users (id, name, email, passwordHash, createdAt) VALUES (@id, @name, @email, @passwordHash, @createdAt)"
  ).run({ id, name, email, passwordHash, createdAt });

  const token = createSession(db, id);
  return { user: toPublicUser({ id, name, email, passwordHash, createdAt }), token };
}

export async function login(
  db: DatabaseSync,
  input: { email: unknown; password: unknown }
): Promise<{ user: PublicUser; token: string }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  if (!email || !password) throw Errors.invalidCredentials();

  const user = getUserByEmail(db, email);
  if (!user) throw Errors.invalidCredentials();

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw Errors.invalidCredentials();

  const token = createSession(db, user.id);
  return { user: toPublicUser(user), token };
}

export function logout(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Resolves a bearer token to its user, or undefined if invalid/unknown. */
export function getUserByToken(db: DatabaseSync, token: string): PublicUser | undefined {
  const row = db
    .prepare(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.userId
       WHERE sessions.token = ?`
    )
    .get(token) as User | undefined;
  return row ? toPublicUser(row) : undefined;
}

export function getPublicUserById(db: DatabaseSync, id: string): PublicUser | undefined {
  const user = getUserById(db, id);
  return user ? toPublicUser(user) : undefined;
}
