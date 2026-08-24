import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { buildTestApp, teardownTestDb, seedUser, seedResource, seedSession } from "../helpers.js";

let app: Express;
let db: DatabaseSync;
let dbPath: string;
let userId: string;
let token: string;
let resourceId: string;

beforeEach(() => {
  ({ app, db, dbPath } = buildTestApp());
  userId = seedUser(db);
  token = seedSession(db, userId);
  resourceId = seedResource(db);
});

afterEach(() => teardownTestDb(db, dbPath));

function future(minutesFromNow: number, durationMinutes = 60) {
  const start = new Date(Date.now() + minutesFromNow * 60_000);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function auth(req: request.Test, t: string = token): request.Test {
  return req.set("Authorization", `Bearer ${t}`);
}

describe("GET /api/resources", () => {
  it("lists resources", async () => {
    const res = await request(app).get("/api/resources");
    expect(res.status).toBe(200);
    expect(res.body.resources.length).toBeGreaterThan(0);
  });

  it("404s for an unknown resource", async () => {
    const res = await request(app).get("/api/resources/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });
});

describe("GET /api/resources/:id/availability", () => {
  it("reports available when nothing is booked", async () => {
    const { startAt, endAt } = future(60);
    const res = await request(app).get(`/api/resources/${resourceId}/availability`).query({ startAt, endAt });
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.advisory).toBe(true);
  });

  it("reports unavailable once booked", async () => {
    const { startAt, endAt } = future(60);
    await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    const res = await request(app).get(`/api/resources/${resourceId}/availability`).query({ startAt, endAt });
    expect(res.body.available).toBe(false);
  });
});

describe("POST /api/bookings", () => {
  it("requires authentication", async () => {
    const { startAt, endAt } = future(60);
    const res = await request(app).post("/api/bookings").send({ resourceId, startAt, endAt });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid/unknown bearer token", async () => {
    const { startAt, endAt } = future(60);
    const res = await request(app)
      .post("/api/bookings")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ resourceId, startAt, endAt });
    expect(res.status).toBe(401);
  });

  it("creates a booking and returns 201", async () => {
    const { startAt, endAt } = future(60);
    const res = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe("CONFIRMED");
    expect(res.body.booking.resourceId).toBe(resourceId);
  });

  it("rejects a booking in the past with 400", async () => {
    const startAt = new Date(Date.now() - 3600_000).toISOString();
    const endAt = new Date(Date.now() - 1800_000).toISOString();
    const res = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BOOKING_IN_PAST");
  });

  it("rejects end before start with 400", async () => {
    const { startAt, endAt } = future(60);
    const res = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt: endAt, endAt: startAt });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown resource with 404", async () => {
    const { startAt, endAt } = future(60);
    const res = await auth(request(app).post("/api/bookings")).send({ resourceId: "ghost", startAt, endAt });
    expect(res.status).toBe(404);
  });

  it("returns 409 SLOT_TAKEN without leaking the other user's info", async () => {
    const other = seedUser(db, { name: "Private Person", email: "private@example.com" });
    const otherToken = seedSession(db, other);
    const { startAt, endAt } = future(60);
    await auth(request(app).post("/api/bookings"), otherToken).send({ resourceId, startAt, endAt });

    const res = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("SLOT_TAKEN");
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/Private Person/);
    expect(bodyText).not.toMatch(/private@example\.com/);
  });
});

describe("GET/POST cancellation via API", () => {
  it("cancels a booking well before its start", async () => {
    const { startAt, endAt } = future(30);
    const create = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    const cancel = await auth(request(app).post(`/api/bookings/${create.body.booking.id}/cancel`));
    expect(cancel.status).toBe(200);
    expect(cancel.body.booking.status).toBe("CANCELLED");
  });

  it("cannot cancel a booking belonging to another user", async () => {
    const other = seedUser(db);
    const otherToken = seedSession(db, other);
    const { startAt, endAt } = future(30);
    const create = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    const cancel = await auth(request(app).post(`/api/bookings/${create.body.booking.id}/cancel`), otherToken);
    expect(cancel.status).toBe(404);
  });

  it("a cancelled slot can be re-booked", async () => {
    const { startAt, endAt } = future(30);
    const create = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    await auth(request(app).post(`/api/bookings/${create.body.booking.id}/cancel`));

    const rebook = await auth(request(app).post("/api/bookings")).send({ resourceId, startAt, endAt });
    expect(rebook.status).toBe(201);
  });
});

describe("GET /api/bookings", () => {
  it("only returns the requesting user's bookings", async () => {
    const other = seedUser(db);
    const otherToken = seedSession(db, other);
    const mine = future(30);
    const theirs = future(120);
    await auth(request(app).post("/api/bookings")).send({ resourceId, ...mine });
    await auth(request(app).post("/api/bookings"), otherToken).send({ resourceId, ...theirs });

    const res = await auth(request(app).get("/api/bookings"));
    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].userId).toBe(userId);
  });
});
