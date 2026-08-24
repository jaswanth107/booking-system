import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { cancelBooking, createBooking } from "../../src/services/bookingService.js";
import { AppError } from "../../src/services/errors.js";
import { setupTestDb, teardownTestDb, seedUser, seedResource } from "../helpers.js";

let db: DatabaseSync;
let dbPath: string;
let userId: string;
let resourceId: string;

beforeEach(() => {
  ({ db, dbPath } = setupTestDb());
  userId = seedUser(db);
  resourceId = seedResource(db);
});

afterEach(() => teardownTestDb(db, dbPath));

const NOW = new Date("2026-06-15T12:00:00Z");
function iso(hours: number, minutes = 0, day = 15) {
  return `2026-06-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`;
}

describe("createBooking validation", () => {
  it("creates a valid booking", () => {
    const booking = createBooking(db, { resourceId, userId, startAt: iso(16), endAt: iso(17) }, NOW);
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.resourceId).toBe(resourceId);
  });

  it("rejects an unknown resource", () => {
    expect(() =>
      createBooking(db, { resourceId: "nope", userId, startAt: iso(16), endAt: iso(17) }, NOW)
    ).toThrowError(/not.*found/i);
  });

  it("rejects a start time in the past", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(10), endAt: iso(11) }, NOW)
    ).toThrow(/past/i);
  });

  it("rejects end before start", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(17), endAt: iso(16) }, NOW)
    ).toThrow(/before/i);
  });

  it("rejects a zero-duration booking", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(16), endAt: iso(16) }, NOW)
    ).toThrow(/before/i);
  });

  it("rejects invalid timestamps", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: "banana", endAt: iso(17) }, NOW)
    ).toThrow(AppError);
  });

  it("rejects an unauthenticated request (no/invalid userId)", () => {
    expect(() =>
      createBooking(db, { resourceId, userId: "ghost-user", startAt: iso(16), endAt: iso(17) }, NOW)
    ).toThrow(AppError);
  });
});

describe("overlap matrix", () => {
  beforeEach(() => {
    createBooking(db, { resourceId, userId, startAt: iso(16), endAt: iso(17) }, NOW); // 16:00-17:00
  });

  it("exact same interval -> conflict", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(16), endAt: iso(17) }, NOW)
    ).toThrow(/no longer available/i);
  });

  it("partial overlap at beginning -> conflict", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(15, 30), endAt: iso(16, 30) }, NOW)
    ).toThrow(/no longer available/i);
  });

  it("partial overlap at end -> conflict", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(16, 30), endAt: iso(17, 30) }, NOW)
    ).toThrow(/no longer available/i);
  });

  it("existing inside requested -> conflict", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(15), endAt: iso(18) }, NOW)
    ).toThrow(/no longer available/i);
  });

  it("requested inside existing -> conflict", () => {
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(16, 15), endAt: iso(16, 45) }, NOW)
    ).toThrow(/no longer available/i);
  });

  it("adjacent before (ends exactly when existing starts) -> allowed", () => {
    const b = createBooking(db, { resourceId, userId, startAt: iso(15), endAt: iso(16) }, NOW);
    expect(b.status).toBe("CONFIRMED");
  });

  it("adjacent after (starts exactly when existing ends) -> allowed", () => {
    const b = createBooking(db, { resourceId, userId, startAt: iso(17), endAt: iso(18) }, NOW);
    expect(b.status).toBe("CONFIRMED");
  });
});

describe("boundary example from spec", () => {
  it("existing 4:00-5:00, requested 4:30-5:30 -> reject", () => {
    createBooking(db, { resourceId, userId, startAt: iso(16), endAt: iso(17) }, NOW);
    expect(() =>
      createBooking(db, { resourceId, userId, startAt: iso(16, 30), endAt: iso(17, 30) }, NOW)
    ).toThrow(/no longer available/i);
  });

  it("existing 4:00-4:30, requested 4:30-5:30 -> allow", () => {
    createBooking(db, { resourceId, userId, startAt: iso(16), endAt: iso(16, 30) }, NOW);
    const b = createBooking(db, { resourceId, userId, startAt: iso(16, 30), endAt: iso(17, 30) }, NOW);
    expect(b.status).toBe("CONFIRMED");
  });

  it("existing 5:30-6:30, requested 4:30-5:30 -> allow", () => {
    createBooking(db, { resourceId, userId, startAt: iso(17, 30), endAt: iso(18, 30) }, NOW);
    const b = createBooking(db, { resourceId, userId, startAt: iso(16, 30), endAt: iso(17, 30) }, NOW);
    expect(b.status).toBe("CONFIRMED");
  });
});

describe("cancellation window (1 minute before start)", () => {
  it("2 minutes before start -> allowed", () => {
    const start = new Date(NOW.getTime() + 2 * 60 * 1000);
    const booking = createBooking(db, { resourceId, userId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString() }, NOW);
    const cancelled = cancelBooking(db, booking.id, userId, NOW);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("exactly 1 minute before start -> allowed", () => {
    const start = new Date(NOW.getTime() + 60 * 1000);
    const booking = createBooking(db, { resourceId, userId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString() }, NOW);
    const cancelled = cancelBooking(db, booking.id, userId, NOW);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("59 seconds before start -> rejected", () => {
    const start = new Date(NOW.getTime() + 59 * 1000);
    const booking = createBooking(db, { resourceId, userId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString() }, NOW);
    expect(() => cancelBooking(db, booking.id, userId, NOW)).toThrow(/no longer be cancelled/i);
  });

  it("after start -> rejected", () => {
    const start = new Date(NOW.getTime() + 60 * 1000);
    const booking = createBooking(db, { resourceId, userId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString() }, NOW);
    const afterStart = new Date(start.getTime() + 5000);
    expect(() => cancelBooking(db, booking.id, userId, afterStart)).toThrow(/no longer be cancelled/i);
  });

  it("cancelling an already-cancelled booking fails", () => {
    const start = new Date(NOW.getTime() + 5 * 60 * 1000);
    const booking = createBooking(db, { resourceId, userId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString() }, NOW);
    cancelBooking(db, booking.id, userId, NOW);
    expect(() => cancelBooking(db, booking.id, userId, NOW)).toThrow(/already cancelled/i);
  });
});

describe("a cancelled booking releases its slot", () => {
  it("allows a new booking for the same resource/time after cancellation", () => {
    const start = new Date(NOW.getTime() + 5 * 60 * 1000);
    const end = new Date(start.getTime() + 3600_000);
    const first = createBooking(db, { resourceId, userId, startAt: start.toISOString(), endAt: end.toISOString() }, NOW);
    cancelBooking(db, first.id, userId, NOW);

    const second = createBooking(db, { resourceId, userId, startAt: start.toISOString(), endAt: end.toISOString() }, NOW);
    expect(second.status).toBe("CONFIRMED");
    expect(second.id).not.toBe(first.id);
  });
});
