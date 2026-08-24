import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema.js";

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

  return db;
}

export type { DatabaseSync };
