import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { buildTestApp, teardownTestDb } from "../helpers.js";
import { ensureDefaultAdmin } from "../../src/services/authService.js";

let app: Express;
let db: DatabaseSync;
let dbPath: string;

beforeEach(() => {
  ({ app, db, dbPath } = buildTestApp());
});

afterEach(() => teardownTestDb(db, dbPath));

const PW = "correcthorse1";

function signupBody(overrides: Partial<{ name: string; email: string; password: string; confirmPassword: string }> = {}) {
  return {
    name: "Dana Lee",
    email: "dana@example.com",
    password: PW,
    confirmPassword: PW,
    ...overrides
  };
}

describe("POST /api/auth/signup", () => {
  it("creates a new account and returns a token", async () => {
    const res = await request(app).post("/api/auth/signup").send(signupBody());
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("dana@example.com");
    expect(res.body.user.role).toBe("USER");
    expect(res.body.user.status).toBe("ACTIVE");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email with 409", async () => {
    await request(app).post("/api/auth/signup").send(signupBody());
    const res = await request(app)
      .post("/api/auth/signup")
      .send(signupBody({ name: "Someone Else", password: "anotherpass1", confirmPassword: "anotherpass1" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("EMAIL_TAKEN");
  });

  it("rejects a duplicate email case-insensitively", async () => {
    await request(app).post("/api/auth/signup").send(signupBody());
    const res = await request(app).post("/api/auth/signup").send(signupBody({ email: "DANA@Example.com" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("EMAIL_TAKEN");
  });

  it("rejects a weak password", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send(signupBody({ email: "dana2@example.com", password: "short", confirmPassword: "short" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("WEAK_PASSWORD");
  });

  it("rejects mismatched password/confirmPassword", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send(signupBody({ email: "dana4@example.com", confirmPassword: "somethingElse1" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("PASSWORD_MISMATCH");
  });

  it("rejects a missing name or invalid email", async () => {
    const res1 = await request(app).post("/api/auth/signup").send(signupBody({ name: "", email: "dana3@example.com" }));
    expect(res1.status).toBe(400);

    const res2 = await request(app).post("/api/auth/signup").send(signupBody({ email: "not-an-email" }));
    expect(res2.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await request(app).post("/api/auth/signup").send(signupBody());
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "dana@example.com", password: PW });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("dana@example.com");
  });

  it("is case-insensitive on email", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "DANA@Example.com", password: PW });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong password with 401 and no hint", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "dana@example.com", password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an unknown email with the same 401 (no user enumeration)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "whatever1" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_CREDENTIALS");
  });

  it("rejects login for a deactivated account", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send(signupBody({ email: "willbeblocked@example.com" }));
    expect(signup.status).toBe(201);
    db.prepare("UPDATE users SET status = 'INACTIVE' WHERE id = ?").run(signup.body.user.id);

    const res = await request(app).post("/api/auth/login").send({ email: "willbeblocked@example.com", password: PW });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ACCOUNT_INACTIVE");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the current user for a valid token", async () => {
    const signup = await request(app).post("/api/auth/signup").send(signupBody());
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${signup.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("dana@example.com");
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("invalidates the token", async () => {
    const signup = await request(app).post("/api/auth/signup").send(signupBody());
    const token = signup.body.token;

    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
  });
});

describe("POST /api/auth/change-password", () => {
  it("changes the password and clears passwordChangeRequired", async () => {
    const signup = await request(app).post("/api/auth/signup").send(signupBody());
    const token = signup.body.token;

    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: PW, newPassword: "brandNewPass1", confirmPassword: "brandNewPass1" });
    expect(change.status).toBe(200);
    expect(change.body.user.passwordChangeRequired).toBe(0);

    const oldLogin = await request(app).post("/api/auth/login").send({ email: "dana@example.com", password: PW });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "dana@example.com", password: "brandNewPass1" });
    expect(newLogin.status).toBe(200);
  });

  it("rejects an incorrect current password", async () => {
    const signup = await request(app).post("/api/auth/signup").send(signupBody());
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${signup.body.token}`)
      .send({ currentPassword: "wrong", newPassword: "brandNewPass1", confirmPassword: "brandNewPass1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INCORRECT_PASSWORD");
  });

  it("on the forced first-login change, lets the default admin claim their own name/email and log in as that identity afterward", async () => {
    await ensureDefaultAdmin(db);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@gmail.com", password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body.user.passwordChangeRequired).toBe(1);

    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({
        currentPassword: "password123",
        newPassword: "myOwnPass123",
        confirmPassword: "myOwnPass123",
        name: "Priya Admin",
        email: "priya@example.com"
      });
    expect(change.status).toBe(200);
    expect(change.body.user.name).toBe("Priya Admin");
    expect(change.body.user.email).toBe("priya@example.com");
    expect(change.body.user.role).toBe("ADMIN");
    expect(change.body.user.passwordChangeRequired).toBe(0);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "priya@example.com", password: "myOwnPass123" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.role).toBe("ADMIN");

    // The default admin bootstrap is a standing invite, not a one-time
    // credential: as soon as Priya claims it, a fresh admin@gmail.com /
    // password123 account is reseeded so the next admin can claim it too.
    const reseededLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@gmail.com", password: "password123" });
    expect(reseededLogin.status).toBe(200);
    expect(reseededLogin.body.user.role).toBe("ADMIN");
    expect(reseededLogin.body.user.passwordChangeRequired).toBe(1);
    expect(reseededLogin.body.user.id).not.toBe(change.body.user.id);
  });

  it("lets a second person claim a freshly reseeded default admin account after the first claims theirs", async () => {
    await ensureDefaultAdmin(db);

    const firstLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@gmail.com", password: "password123" });
    await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${firstLogin.body.token}`)
      .send({
        currentPassword: "password123",
        newPassword: "firstPass123",
        confirmPassword: "firstPass123",
        name: "First Admin",
        email: "first-admin@example.com"
      });

    const secondLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@gmail.com", password: "password123" });
    expect(secondLogin.status).toBe(200);

    const secondChange = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${secondLogin.body.token}`)
      .send({
        currentPassword: "password123",
        newPassword: "secondPass123",
        confirmPassword: "secondPass123",
        name: "Second Admin",
        email: "second-admin@example.com"
      });
    expect(secondChange.status).toBe(200);
    expect(secondChange.body.user.role).toBe("ADMIN");

    const firstStillWorks = await request(app)
      .post("/api/auth/login")
      .send({ email: "first-admin@example.com", password: "firstPass123" });
    expect(firstStillWorks.status).toBe(200);
    expect(firstStillWorks.body.user.role).toBe("ADMIN");
  });

  it("requires name and email on the forced first-login change", async () => {
    await ensureDefaultAdmin(db);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@gmail.com", password: "password123" });

    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({ currentPassword: "password123", newPassword: "myOwnPass123", confirmPassword: "myOwnPass123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });
});

describe("Forgot / reset password", () => {
  it("issues a working reset token and lets the user set a new password", async () => {
    await request(app).post("/api/auth/signup").send(signupBody());

    const forgot = await request(app).post("/api/auth/forgot-password").send({ email: "dana@example.com" });
    expect(forgot.status).toBe(200);

    const row = db.prepare("SELECT token FROM password_resets ORDER BY createdAt DESC LIMIT 1").get() as { token: string };
    expect(row.token).toBeTruthy();

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: row.token, newPassword: "resetPass123", confirmPassword: "resetPass123" });
    expect(reset.status).toBe(200);

    const login = await request(app).post("/api/auth/login").send({ email: "dana@example.com", password: "resetPass123" });
    expect(login.status).toBe(200);
  });

  it("returns the same generic response for an unknown email (no enumeration)", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "ghost@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
  });

  it("rejects a reused or unknown reset token", async () => {
    await request(app).post("/api/auth/signup").send(signupBody());
    await request(app).post("/api/auth/forgot-password").send({ email: "dana@example.com" });
    const row = db.prepare("SELECT token FROM password_resets ORDER BY createdAt DESC LIMIT 1").get() as { token: string };

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: row.token, newPassword: "resetPass123", confirmPassword: "resetPass123" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: row.token, newPassword: "anotherPass1", confirmPassword: "anotherPass1" });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("INVALID_OR_EXPIRED_TOKEN");
  });

  it("rejects an expired reset token", async () => {
    await request(app).post("/api/auth/signup").send(signupBody());
    await request(app).post("/api/auth/forgot-password").send({ email: "dana@example.com" });
    const row = db.prepare("SELECT token FROM password_resets ORDER BY createdAt DESC LIMIT 1").get() as { token: string };
    db.prepare("UPDATE password_resets SET expiresAt = ? WHERE token = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      row.token
    );

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: row.token, newPassword: "resetPass123", confirmPassword: "resetPass123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_OR_EXPIRED_TOKEN");
  });
});
