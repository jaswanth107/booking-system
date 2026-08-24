import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { Booking, BookingStatus, Resource } from "../types.js";
import { Errors } from "./errors.js";
import { CANCELLATION_CUTOFF_MS, parseTimestamp, toUtcIso } from "../utils/time.js";

export interface CreateBookingInput {
  resourceId: unknown;
  userId: unknown;
  startAt: unknown;
  endAt: unknown;
}

type BookingRow = Booking;

function rowToBooking(row: BookingRow): Booking {
  return row;
}

/**
 * Runs fn() inside a SQLite transaction opened with BEGIN IMMEDIATE, which
 * acquires the write lock up front (instead of lazily on first write like a
 * plain BEGIN). This is the core of the concurrency strategy: see
 * createBooking() below and README.md "Concurrency strategy".
 */
function withImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Nothing to roll back (transaction may not have started) - ignore.
    }
    throw err;
  }
}

export function getResourceById(db: DatabaseSync, id: string): Resource | undefined {
  return db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as Resource | undefined;
}

export function listResources(db: DatabaseSync): Resource[] {
  return db.prepare("SELECT * FROM resources ORDER BY name ASC").all() as unknown as Resource[];
}

export function getBookingById(db: DatabaseSync, id: string): Booking | undefined {
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
  return row ? rowToBooking(row) : undefined;
}

export function listBookings(
  db: DatabaseSync,
  filters: { userId?: string; resourceId?: string } = {}
): Booking[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filters.userId) {
    clauses.push("userId = @userId");
    params.userId = filters.userId;
  }
  if (filters.resourceId) {
    clauses.push("resourceId = @resourceId");
    params.resourceId = filters.resourceId;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM bookings ${where} ORDER BY startAt DESC`)
    .all(params) as unknown as BookingRow[];
  return rows.map(rowToBooking);
}

/**
 * Advisory-only: tells the UI whether a slot currently looks free.
 * The authoritative check happens again, atomically, inside createBooking().
 */
export function checkAvailability(
  db: DatabaseSync,
  resourceId: string,
  startAt: Date,
  endAt: Date
): { available: boolean } {
  const conflict = db
    .prepare(
      `SELECT id FROM bookings
       WHERE resourceId = ? AND status = 'CONFIRMED'
         AND startAt < ? AND endAt > ?
       LIMIT 1`
    )
    .get(resourceId, toUtcIso(endAt), toUtcIso(startAt));
  return { available: !conflict };
}

function validateCreateInput(
  db: DatabaseSync,
  input: CreateBookingInput,
  now: Date
): { resourceId: string; userId: string; startAt: Date; endAt: Date } {
  const { resourceId, userId } = input;
  if (typeof resourceId !== "string" || !resourceId) {
    throw Errors.invalidInput("resourceId is required.");
  }
  if (typeof userId !== "string" || !userId) {
    throw Errors.unauthorized();
  }

  const startAt = parseTimestamp(input.startAt);
  const endAt = parseTimestamp(input.endAt);
  if (!startAt) throw Errors.invalidInput("startAt is required and must be a valid timestamp.");
  if (!endAt) throw Errors.invalidInput("endAt is required and must be a valid timestamp.");

  if (startAt.getTime() >= endAt.getTime()) {
    throw Errors.invalidRange("startAt must be strictly before endAt (zero-duration bookings are not allowed).");
  }

  if (startAt.getTime() < now.getTime()) {
    throw Errors.pastBooking();
  }

  const resource = getResourceById(db, resourceId);
  if (!resource) throw Errors.notFound("Resource");

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) throw Errors.unauthorized();

  return { resourceId, userId, startAt, endAt };
}

/**
 * Creates a booking with a database-enforced no-overlap guarantee.
 *
 * Concurrency strategy: the overlap check + insert run inside a single
 * SQLite transaction opened with BEGIN IMMEDIATE. That acquires SQLite's
 * write lock up front, so if two requests race for the same resource/time,
 * the second transaction blocks until the first commits, then re-runs its
 * overlap query against the now-committed state and correctly sees the
 * conflict. Exactly one of the two ever reaches INSERT.
 *
 * See README.md "Concurrency strategy" for the full explanation.
 */
export function createBooking(
  db: DatabaseSync,
  input: CreateBookingInput,
  now: Date = new Date()
): Booking {
  const { resourceId, userId, startAt, endAt } = validateCreateInput(db, input, now);

  const bookingId = withImmediateTransaction(db, () => {
    const conflict = db
      .prepare(
        `SELECT id FROM bookings
         WHERE resourceId = ? AND status = 'CONFIRMED'
           AND startAt < ? AND endAt > ?
         LIMIT 1`
      )
      .get(resourceId, toUtcIso(endAt), toUtcIso(startAt));

    if (conflict) {
      throw Errors.slotTaken();
    }

    const id = uuidv4();
    const createdAt = toUtcIso(now);
    const status: BookingStatus = "CONFIRMED";

    db.prepare(
      `INSERT INTO bookings (id, resourceId, userId, startAt, endAt, status, createdAt, cancelledAt)
       VALUES (@id, @resourceId, @userId, @startAt, @endAt, @status, @createdAt, NULL)`
    ).run({
      id,
      resourceId,
      userId,
      startAt: toUtcIso(startAt),
      endAt: toUtcIso(endAt),
      status,
      createdAt
    });

    return id;
  });

  return getBookingById(db, bookingId)!;
}

export function cancelBooking(
  db: DatabaseSync,
  bookingId: string,
  userId: string,
  now: Date = new Date()
): Booking {
  const id = withImmediateTransaction(db, () => {
    const booking = getBookingById(db, bookingId);
    if (!booking) throw Errors.notFound("Booking");
    if (booking.userId !== userId) throw Errors.notFound("Booking");
    if (booking.status === "CANCELLED") throw Errors.alreadyCancelled();

    const startAt = new Date(booking.startAt);
    const msUntilStart = startAt.getTime() - now.getTime();
    if (msUntilStart < CANCELLATION_CUTOFF_MS) {
      throw Errors.cancellationWindowClosed();
    }

    db.prepare(`UPDATE bookings SET status = 'CANCELLED', cancelledAt = ? WHERE id = ?`).run(
      toUtcIso(now),
      bookingId
    );

    return bookingId;
  });

  return getBookingById(db, id)!;
}
