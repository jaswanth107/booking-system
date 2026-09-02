import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { Booking, BookingWithResource } from "../types.js";
import { Errors } from "./errors.js";
import { CANCELLATION_CUTOFF_MS, parseTimestamp, toUtcIso } from "../utils/time.js";
import { getResourceById } from "./resourceService.js";
import { logAction } from "./auditLog.js";

export interface CreateBookingInput {
  resourceId: unknown;
  userId: unknown;
  startAt: unknown;
  endAt: unknown;
}

function rowToBooking(row: Booking): Booking {
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

/** Human-friendly sequential booking reference, e.g. BK-2026-000001. Must be
 * called inside the same BEGIN IMMEDIATE transaction as the insert it's for,
 * so the increment is race-free under the same lock as the overlap check. */
function nextBookingRef(db: DatabaseSync, now: Date): string {
  const year = now.getUTCFullYear();
  db.prepare("INSERT OR IGNORE INTO booking_counters (year, seq) VALUES (?, 0)").run(year);
  const row = db.prepare("SELECT seq FROM booking_counters WHERE year = ?").get(year) as { seq: number };
  const seq = row.seq + 1;
  db.prepare("UPDATE booking_counters SET seq = ? WHERE year = ?").run(seq, year);
  return `BK-${year}-${String(seq).padStart(6, "0")}`;
}

export function getBookingById(db: DatabaseSync, id: string): Booking | undefined {
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as Booking | undefined;
  return row ? rowToBooking(row) : undefined;
}

export function listBookings(
  db: DatabaseSync,
  filters: { userId?: string; resourceId?: string } = {}
): BookingWithResource[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filters.userId) {
    clauses.push("bookings.userId = @userId");
    params.userId = filters.userId;
  }
  if (filters.resourceId) {
    clauses.push("bookings.resourceId = @resourceId");
    params.resourceId = filters.resourceId;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT bookings.*, resources.name as resourceName, resources.location as resourceLocation
       FROM bookings
       JOIN resources ON resources.id = bookings.resourceId
       ${where}
       ORDER BY bookings.startAt DESC`
    )
    .all(params) as unknown as BookingWithResource[];
  return rows;
}

/**
 * Admin view: every booking, joined with the user/resource names needed for
 * "who booked what, when" without N+1 lookups. Supports optional filters.
 */
export interface AdminBookingRow extends Booking {
  userName: string;
  userEmail: string;
  resourceName: string;
}

export function listBookingsForAdmin(
  db: DatabaseSync,
  filters: { q?: string; date?: string; resourceId?: string; status?: string; userId?: string } = {}
): AdminBookingRow[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (filters.q) {
    clauses.push(
      "(users.name LIKE @q OR users.email LIKE @q OR bookings.bookingRef LIKE @q OR resources.name LIKE @q)"
    );
    params.q = `%${filters.q}%`;
  }
  if (filters.date) {
    clauses.push("date(bookings.startAt) = @date");
    params.date = filters.date;
  }
  if (filters.resourceId) {
    clauses.push("bookings.resourceId = @resourceId");
    params.resourceId = filters.resourceId;
  }
  if (filters.status) {
    clauses.push("bookings.status = @status");
    params.status = filters.status;
  }
  if (filters.userId) {
    clauses.push("bookings.userId = @userId");
    params.userId = filters.userId;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT bookings.*, users.name as userName, users.email as userEmail, resources.name as resourceName
       FROM bookings
       JOIN users ON users.id = bookings.userId
       JOIN resources ON resources.id = bookings.resourceId
       ${where}
       ORDER BY bookings.startAt DESC`
    )
    .all(params) as unknown as AdminBookingRow[];
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
  const resource = getResourceById(db, resourceId);
  if (resource && resource.status !== "AVAILABLE") return { available: false };

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
  if (resource.status !== "AVAILABLE") throw Errors.resourceUnavailable(resource.status);

  // The caller (route layer) only ever supplies a userId that came from a
  // verified, currently-active session (see middleware/auth.ts), so an
  // inactive/unknown user can't reach this point — this is just belt-and-
  // suspenders against a bad internal caller, not the primary enforcement.
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
    const bookingRef = nextBookingRef(db, now);
    const createdAt = toUtcIso(now);

    db.prepare(
      `INSERT INTO bookings (id, bookingRef, resourceId, userId, startAt, endAt, status, createdAt, cancelledAt, cancelledBy)
       VALUES (@id, @bookingRef, @resourceId, @userId, @startAt, @endAt, 'CONFIRMED', @createdAt, NULL, NULL)`
    ).run({
      id,
      bookingRef,
      resourceId,
      userId,
      startAt: toUtcIso(startAt),
      endAt: toUtcIso(endAt),
      createdAt
    });

    return id;
  });

  const booking = getBookingById(db, bookingId)!;
  logAction(db, {
    actorId: userId,
    action: "BOOKING_CREATED",
    entityType: "booking",
    entityId: booking.id,
    details: { bookingRef: booking.bookingRef, resourceId, startAt: booking.startAt, endAt: booking.endAt }
  });
  return booking;
}

function cancelBookingInternal(
  db: DatabaseSync,
  bookingId: string,
  now: Date,
  opts: { userId?: string; enforceOwnership: boolean; enforceCutoff: boolean; cancelledBy: string }
): Booking {
  const id = withImmediateTransaction(db, () => {
    const booking = getBookingById(db, bookingId);
    if (!booking) throw Errors.notFound("Booking");
    if (opts.enforceOwnership && booking.userId !== opts.userId) throw Errors.notFound("Booking");
    if (booking.status === "CANCELLED") throw Errors.alreadyCancelled();

    if (opts.enforceCutoff) {
      const startAt = new Date(booking.startAt);
      const msUntilStart = startAt.getTime() - now.getTime();
      if (msUntilStart < CANCELLATION_CUTOFF_MS) {
        throw Errors.cancellationWindowClosed();
      }
    }

    db.prepare(`UPDATE bookings SET status = 'CANCELLED', cancelledAt = ?, cancelledBy = ? WHERE id = ?`).run(
      toUtcIso(now),
      opts.cancelledBy,
      bookingId
    );

    return bookingId;
  });

  return getBookingById(db, id)!;
}

/** A user cancelling their own booking: ownership + the 1-minute cutoff are both enforced. */
export function cancelBooking(db: DatabaseSync, bookingId: string, userId: string, now: Date = new Date()): Booking {
  const booking = cancelBookingInternal(db, bookingId, now, {
    userId,
    enforceOwnership: true,
    enforceCutoff: true,
    cancelledBy: userId
  });
  logAction(db, {
    actorId: userId,
    action: "BOOKING_CANCELLED",
    entityType: "booking",
    entityId: booking.id,
    details: { bookingRef: booking.bookingRef }
  });
  return booking;
}

/** Admin override: any booking, any time (including past the cutoff) — the
 * confirmation dialog and audit trail live at the route/UI layer. */
export function adminCancelBooking(db: DatabaseSync, bookingId: string, adminUserId: string, now: Date = new Date()): Booking {
  const booking = cancelBookingInternal(db, bookingId, now, {
    enforceOwnership: false,
    enforceCutoff: false,
    cancelledBy: `ADMIN:${adminUserId}`
  });
  logAction(db, {
    actorId: adminUserId,
    action: "ADMIN_BOOKING_CANCELLED",
    entityType: "booking",
    entityId: booking.id,
    details: { bookingRef: booking.bookingRef, originalUserId: booking.userId }
  });
  return booking;
}
