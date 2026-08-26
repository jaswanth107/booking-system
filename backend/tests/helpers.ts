import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { openDatabase } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import type { DatabaseSync } from "node:sqlite";

export function setupTestDb(): { db: DatabaseSync; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `booking-test-${uuidv4()}.sqlite`);
  const db = openDatabase(dbPath);
  return { db, dbPath };
}

export function teardownTestDb(db: DatabaseSync, dbPath: string) {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

export function seedUser(
  db: DatabaseSync,
  overrides: Partial<{ name: string; email: string; role: "USER" | "ADMIN"; status: "ACTIVE" | "INACTIVE" }> = {}
) {
  const id = uuidv4();
  db.prepare(
    "INSERT INTO users (id, name, email, passwordHash, role, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    overrides.name ?? "Test User",
    overrides.email ?? `${id}@example.com`,
    "unused-in-tests", // tests authenticate via seedSession(), never via real login
    overrides.role ?? "USER",
    overrides.status ?? "ACTIVE",
    new Date().toISOString()
  );
  return id;
}

/** Creates a session row directly (bypassing signup/login) so HTTP-layer tests can
 * authenticate as a given seeded user without going through the real password flow. */
export function seedSession(db: DatabaseSync, userId: string): string {
  const token = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  db.prepare("INSERT INTO sessions (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)").run(
    token,
    userId,
    expiresAt.toISOString(),
    now.toISOString()
  );
  return token;
}

export function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

export function seedResource(
  db: DatabaseSync,
  overrides: Partial<{ name: string; capacity: number; status: "AVAILABLE" | "MAINTENANCE" | "DISABLED" }> = {}
) {
  const id = uuidv4();
  db.prepare(
    "INSERT INTO resources (id, name, description, location, bestForUse, capacity, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    overrides.name ?? "Test Room",
    "desc",
    "loc",
    "testing",
    overrides.capacity ?? 4,
    overrides.status ?? "AVAILABLE",
    new Date().toISOString()
  );
  return id;
}

export function buildTestApp() {
  const { db, dbPath } = setupTestDb();
  const app = createApp(db);
  return { app, db, dbPath };
}
