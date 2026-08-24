import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { buildTestApp, teardownTestDb } from "../helpers.js";

let app: Express;
let db: DatabaseSync;
let dbPath: string;

beforeEach(() => {
  ({ app, db, dbPath } = buildTestApp());
});

afterEach(() => teardownTestDb(db, dbPath));

describe("POST /api/auth/signup", () => {
  it("creates a new account and returns a token", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Dana Lee", email: "dana@example.com", password: "correcthorse" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("dana@example.com");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email with 409", async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ name: "Dana Lee", email: "dana@example.com", password: "correcthorse" });
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Someone Else", email: "dana@example.com", password: "anotherpass1" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("EMAIL_TAKEN");
  });

  it("rejects a weak password", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Dana Lee", email: "dana2@example.com", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("WEAK_PASSWORD");
  });

  it("rejects a missing name or invalid email", async () => {
    const res1 = await request(app)
      .post("/api/auth/signup")
      .send({ name: "", email: "dana3@example.com", password: "correcthorse" });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Dana", email: "not-an-email", password: "correcthorse" });
    expect(res2.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await request(app)
      .post("/api/auth/signup")
      .send({ name: "Dana Lee", email: "dana@example.com", password: "correcthorse" });
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "dana@example.com", password: "correcthorse" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("dana@example.com");
  });

  it("is case-insensitive on email", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "DANA@Example.com", password: "correcthorse" });
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
});

describe("GET /api/auth/me", () => {
  it("returns the current user for a valid token", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Dana Lee", email: "dana@example.com", password: "correcthorse" });
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
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Dana Lee", email: "dana@example.com", password: "correcthorse" });
    const token = signup.body.token;

    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
  });
});
