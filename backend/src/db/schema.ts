// Embedded as a TS string (rather than read from a .sql file at runtime) so
// it survives the tsc build unmodified — tsc doesn't copy non-.ts files into
// dist/, and a missing schema file would otherwise crash the app on boot.
//
// All timestamps are stored as ISO-8601 UTC strings (e.g. 2026-08-24T16:30:00.000Z).
// SQLite has no native range/exclusion constraint, so the no-overlap guarantee is
// enforced transactionally in bookingService.ts using BEGIN IMMEDIATE locking.
// See README.md "Concurrency strategy" for the full explanation.
//
// This only covers CREATE TABLE IF NOT EXISTS, which is a no-op against an
// already-existing table — it does NOT add new columns to a table created by
// an older version of this schema. See MIGRATIONS in db/index.ts for that.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  passwordChangeRequired INTEGER NOT NULL DEFAULT 0,
  lastLoginAt TEXT,
  createdAt TEXT NOT NULL
);

-- Opaque bearer tokens issued at login/signup. Expire after a fixed window
-- (see authService.ts SESSION_TTL_MS); logout also deletes the row early.
-- Never trust a client-supplied user id directly - every authenticated
-- request resolves userId through this table, and re-checks the user's
-- current role/status on every request (not just at login time).
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (userId);

-- Forgot-password tokens. One-time use (usedAt), short-lived (expiresAt).
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  expiresAt TEXT NOT NULL,
  usedAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (userId);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,               -- "Place Name" in the admin UI
  location TEXT NOT NULL DEFAULT '', -- "Landmark" in the admin UI
  bestForUse TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  facilities TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  imageUrl TEXT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'MAINTENANCE', 'DISABLED')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS booking_counters (
  year INTEGER PRIMARY KEY,
  seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  bookingRef TEXT UNIQUE,
  resourceId TEXT NOT NULL REFERENCES resources(id),
  userId TEXT NOT NULL REFERENCES users(id),
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  createdAt TEXT NOT NULL,
  cancelledAt TEXT,
  cancelledBy TEXT -- userId or 'ADMIN:<adminUserId>', for the audit trail
);

-- Speeds up the overlap-check query (resource + status + time range) which runs
-- inside every booking-creation transaction.
CREATE INDEX IF NOT EXISTS idx_bookings_resource_status_time
  ON bookings (resourceId, status, startAt, endAt);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (userId);

-- Records notable actions for admin visibility. Never stores passwords,
-- hashes, or reset tokens. actorId is nullable (e.g. a failed login attempt
-- against an email with no matching account has no actor id).
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actorId TEXT,
  actorEmail TEXT,
  action TEXT NOT NULL,
  entityType TEXT,
  entityId TEXT,
  details TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (createdAt);
`;
