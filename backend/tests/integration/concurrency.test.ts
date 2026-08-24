import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { buildTestApp, teardownTestDb, seedUser, seedResource, seedSession } from "../helpers.js";

/**
 * This is the mandatory "double booking must be impossible" test.
 * Two requests for the exact same resource/time are fired concurrently at a
 * real HTTP server. Express's async middleware pipeline (body parsing, etc.)
 * lets both requests genuinely interleave up until the point each reaches
 * bookingService.createBooking(); the BEGIN IMMEDIATE transaction inside
 * that function then serializes the two writers at the database level, so
 * the second one deterministically re-checks and sees the conflict.
 */
describe("critical concurrency test: same resource, same time, simultaneous requests", () => {
  let app: Express;
  let db: DatabaseSync;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;
  let resourceId: string;

  beforeEach(() => {
    ({ app, db, dbPath } = buildTestApp());
    const userA = seedUser(db, { name: "User A" });
    const userB = seedUser(db, { name: "User B" });
    tokenA = seedSession(db, userA);
    tokenB = seedSession(db, userB);
    resourceId = seedResource(db);
  });

  afterEach(() => teardownTestDb(db, dbPath));

  it("exactly one of two simultaneous bookings succeeds, the other gets 409", async () => {
    const startAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const endAt = new Date(Date.now() + 120 * 60_000).toISOString();

    const results = await Promise.all([
      request(app).post("/api/bookings").set("Authorization", `Bearer ${tokenA}`).send({ resourceId, startAt, endAt }),
      request(app).post("/api/bookings").set("Authorization", `Bearer ${tokenB}`).send({ resourceId, startAt, endAt })
    ]);

    const successful = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    expect(successful).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].body.error).toBe("SLOT_TAKEN");

    const rows = db
      .prepare("SELECT * FROM bookings WHERE resourceId = ? AND status = 'CONFIRMED'")
      .all(resourceId);
    expect(rows).toHaveLength(1);
  });

  it("holds under higher concurrency: 10 simultaneous requests, exactly 1 wins", async () => {
    const startAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const endAt = new Date(Date.now() + 120 * 60_000).toISOString();

    const requests = Array.from({ length: 10 }, (_, i) =>
      request(app)
        .post("/api/bookings")
        .set("Authorization", `Bearer ${i % 2 === 0 ? tokenA : tokenB}`)
        .send({ resourceId, startAt, endAt })
    );

    const results = await Promise.all(requests);
    const successful = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    expect(successful).toHaveLength(1);
    expect(conflicts).toHaveLength(9);

    const rows = db
      .prepare("SELECT * FROM bookings WHERE resourceId = ? AND status = 'CONFIRMED'")
      .all(resourceId);
    expect(rows).toHaveLength(1);
  });
});
