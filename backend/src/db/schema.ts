// Embedded as a TS string (rather than read from schema.sql at runtime) so
// it survives the tsc build unmodified — tsc doesn't copy non-.ts files into
// dist/, and a missing schema file would otherwise crash the app on boot.
//
// All timestamps are stored as ISO-8601 UTC strings (e.g. 2026-08-24T16:30:00.000Z).
// SQLite has no native range/exclusion constraint, so the no-overlap guarantee is
// enforced transactionally in bookingService.ts using BEGIN IMMEDIATE locking.
// See README.md "Concurrency strategy" for the full explanation.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

-- Opaque bearer tokens issued at login/signup. No expiry in this demo scope;
-- logout deletes the row. Never trust a client-supplied user id directly -
-- every authenticated request resolves userId through this table.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (userId);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  resourceId TEXT NOT NULL REFERENCES resources(id),
  userId TEXT NOT NULL REFERENCES users(id),
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  createdAt TEXT NOT NULL,
  cancelledAt TEXT
);

-- Speeds up the overlap-check query (resource + status + time range) which runs
-- inside every booking-creation transaction.
CREATE INDEX IF NOT EXISTS idx_bookings_resource_status_time
  ON bookings (resourceId, status, startAt, endAt);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (userId);
`;
