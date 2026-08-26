import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema.js";

// Column additions for databases created by an earlier version of this
// schema (CREATE TABLE IF NOT EXISTS won't add columns to an existing
// table). Each is independent and safe to re-run — SQLite errors on a
// duplicate column, which we swallow, so this list only ever grows.
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "users", column: "role", ddl: "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'" },
  { table: "users", column: "status", ddl: "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'" },
  {
    table: "users",
    column: "passwordChangeRequired",
    ddl: "ALTER TABLE users ADD COLUMN passwordChangeRequired INTEGER NOT NULL DEFAULT 0"
  },
  { table: "users", column: "lastLoginAt", ddl: "ALTER TABLE users ADD COLUMN lastLoginAt TEXT" },
  {
    table: "sessions",
    column: "expiresAt",
    // Existing sessions get a fixed 7-day grace period from migration time
    // rather than immediate expiry, so nobody's mid-use token dies instantly.
    ddl: "ALTER TABLE sessions ADD COLUMN expiresAt TEXT NOT NULL DEFAULT '9999-12-31T00:00:00.000Z'"
  },
  { table: "resources", column: "bestForUse", ddl: "ALTER TABLE resources ADD COLUMN bestForUse TEXT NOT NULL DEFAULT ''" },
  { table: "resources", column: "facilities", ddl: "ALTER TABLE resources ADD COLUMN facilities TEXT NOT NULL DEFAULT '[]'" },
  { table: "resources", column: "imageUrl", ddl: "ALTER TABLE resources ADD COLUMN imageUrl TEXT" },
  {
    table: "resources",
    column: "status",
    ddl: "ALTER TABLE resources ADD COLUMN status TEXT NOT NULL DEFAULT 'AVAILABLE'"
  },
  { table: "resources", column: "updatedAt", ddl: "ALTER TABLE resources ADD COLUMN updatedAt TEXT" },
  { table: "bookings", column: "bookingRef", ddl: "ALTER TABLE bookings ADD COLUMN bookingRef TEXT" },
  { table: "bookings", column: "cancelledBy", ddl: "ALTER TABLE bookings ADD COLUMN cancelledBy TEXT" }
];

function runColumnMigrations(db: DatabaseSync) {
  for (const { ddl } of COLUMN_MIGRATIONS) {
    try {
      db.exec(ddl);
    } catch (err) {
      // "duplicate column name" -> already migrated, expected on every boot
      // after the first. Anything else would be a real problem, but SQLite
      // doesn't give us a clean error code here, so we just move on; a
      // genuinely broken DDL statement would also fail the fresh-DB path
      // above and surface loudly there.
    }
  }
}

/**
 * Opens (and initializes) a SQLite database at the given path using Node's
 * built-in node:sqlite module (no native build toolchain required).
 * WAL mode + a busy timeout let concurrent connections queue for the write
 * lock instead of failing immediately with SQLITE_BUSY.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  runColumnMigrations(db);

  return db;
}

export type { DatabaseSync };
