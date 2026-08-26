import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { buildTestApp, teardownTestDb, seedUser, seedSession, seedResource } from "../helpers.js";

let app: Express;
let db: DatabaseSync;
let dbPath: string;
let adminToken: string;
let userToken: string;
let userId: string;

beforeEach(() => {
  ({ app, db, dbPath } = buildTestApp());
  const adminId = seedUser(db, { role: "ADMIN", name: "Admin User" });
  adminToken = seedSession(db, adminId);
  userId = seedUser(db, { role: "USER" });
  userToken = seedSession(db, userId);
});

afterEach(() => teardownTestDb(db, dbPath));

describe("Admin authorization is backend-enforced", () => {
  it("blocks a regular USER from every admin endpoint with 403, not just hides the UI", async () => {
    const endpoints: Array<[string, string]> = [
      ["get", "/api/admin/dashboard"],
      ["get", "/api/admin/users"],
      ["get", "/api/admin/bookings"],
      ["get", "/api/admin/resources"],
      ["get", "/api/admin/audit-logs"]
    ];
    for (const [method, path] of endpoints) {
      const res = await (request(app) as any)[method](path).set("Authorization", `Bearer ${userToken}`);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    }
  });

  it("rejects an unauthenticated request with 401 before even checking role", async () => {
    const res = await request(app).get("/api/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("allows an ADMIN through", async () => {
    const res = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/dashboard", () => {
  it("reports summary counts", async () => {
    seedResource(db);
    const res = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBeGreaterThanOrEqual(2);
    expect(res.body.totalResources).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.todaysBookings).toBe("number");
  });
});

describe("GET /api/admin/users and status changes", () => {
  it("lists users without exposing password hashes", async () => {
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
    for (const u of res.body.users) {
      expect(u.passwordHash).toBeUndefined();
    }
  });

  it("deactivates and reactivates a user; deactivated user can no longer log in", async () => {
    const target = seedUser(db, { email: "target@example.com" });

    const deactivate = await request(app)
      .post(`/api/admin/users/${target}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INACTIVE" });
    expect(deactivate.status).toBe(200);

    const targetToken = seedSession(db, target);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${targetToken}`);
    expect(me.status).toBe(401); // session lookup itself refuses an inactive user

    const reactivate = await request(app)
      .post(`/api/admin/users/${target}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACTIVE" });
    expect(reactivate.status).toBe(200);
  });

  it("refuses to let an admin deactivate their own account", async () => {
    const selfId = (db.prepare("SELECT userId FROM sessions WHERE token = ?").get(adminToken) as { userId: string }).userId;
    const res = await request(app)
      .post(`/api/admin/users/${selfId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INACTIVE" });
    expect(res.status).toBe(400);
  });
});

describe("Admin resource management", () => {
  it("creates a resource, requiring all four fields", async () => {
    const missing = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Room X", location: "", bestForUse: "meetings", description: "desc" });
    expect(missing.status).toBe(400);

    const whitespaceOnly = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Room X", location: "   ", bestForUse: "meetings", description: "desc" });
    expect(whitespaceOnly.status).toBe(400);

    const ok = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Room X", location: "Near lobby", bestForUse: "meetings", description: "desc", capacity: 6, facilities: ["Wi-Fi", "TV"] });
    expect(ok.status).toBe(201);
    expect(ok.body.resource.status).toBe("AVAILABLE");
    expect(ok.body.resource.facilities).toEqual(["Wi-Fi", "TV"]);
  });

  it("a USER cannot create a resource even by calling the API directly", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Hacked Room", location: "x", bestForUse: "x", description: "x" });
    expect(res.status).toBe(403);
  });

  it("setting a resource to MAINTENANCE blocks new bookings but keeps history", async () => {
    const resourceId = seedResource(db);
    const setStatus = await request(app)
      .post(`/api/admin/resources/${resourceId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "MAINTENANCE" });
    expect(setStatus.status).toBe(200);

    const startAt = new Date(Date.now() + 3600_000).toISOString();
    const endAt = new Date(Date.now() + 7200_000).toISOString();
    const bookAttempt = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ resourceId, startAt, endAt });
    expect(bookAttempt.status).toBe(409);
    expect(bookAttempt.body.error).toBe("RESOURCE_UNAVAILABLE");
  });

  it("refuses to delete a resource that has bookings", async () => {
    const resourceId = seedResource(db);
    const startAt = new Date(Date.now() + 3600_000).toISOString();
    const endAt = new Date(Date.now() + 7200_000).toISOString();
    await request(app).post("/api/bookings").set("Authorization", `Bearer ${userToken}`).send({ resourceId, startAt, endAt });

    const del = await request(app).delete(`/api/admin/resources/${resourceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("RESOURCE_HAS_BOOKINGS");
  });

  it("allows deleting a resource with no bookings", async () => {
    const resourceId = seedResource(db);
    const del = await request(app).delete(`/api/admin/resources/${resourceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
  });
});

describe("Admin booking visibility and cancellation", () => {
  it("shows who booked what, with user + resource details", async () => {
    const resourceId = seedResource(db, { name: "Visible Room" });
    const startAt = new Date(Date.now() + 3600_000).toISOString();
    const endAt = new Date(Date.now() + 7200_000).toISOString();
    await request(app).post("/api/bookings").set("Authorization", `Bearer ${userToken}`).send({ resourceId, startAt, endAt });

    const res = await request(app).get("/api/admin/bookings").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = res.body.bookings.find((b: any) => b.resourceId === resourceId);
    expect(row).toBeTruthy();
    expect(row.resourceName).toBe("Visible Room");
    expect(row.userEmail).toBeTruthy();
    expect(row.bookingRef).toMatch(/^BK-\d{4}-\d{6}$/);
  });

  it("lets an admin cancel any user's booking, bypassing the normal cutoff", async () => {
    const resourceId = seedResource(db);
    const startAt = new Date(Date.now() + 30_000).toISOString(); // 30s out - past the 1-min user cutoff
    const endAt = new Date(Date.now() + 3600_000).toISOString();
    const create = await request(app).post("/api/bookings").set("Authorization", `Bearer ${userToken}`).send({ resourceId, startAt, endAt });
    expect(create.status).toBe(201);

    const userCancelAttempt = await request(app)
      .post(`/api/bookings/${create.body.booking.id}/cancel`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(userCancelAttempt.status).toBe(409); // too close to start for the user

    const adminCancel = await request(app)
      .post(`/api/admin/bookings/${create.body.booking.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminCancel.status).toBe(200);
    expect(adminCancel.body.booking.status).toBe("CANCELLED");
    expect(adminCancel.body.booking.cancelledBy).toMatch(/^ADMIN:/);
  });

  it("exports bookings as CSV", async () => {
    const resourceId = seedResource(db, { name: "CSV Room" });
    const startAt = new Date(Date.now() + 3600_000).toISOString();
    const endAt = new Date(Date.now() + 7200_000).toISOString();
    await request(app).post("/api/bookings").set("Authorization", `Bearer ${userToken}`).send({ resourceId, startAt, endAt });

    const res = await request(app).get("/api/admin/bookings/export.csv").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain("Booking ID");
    expect(res.text).toContain("CSV Room");
    expect(res.text).not.toMatch(/passwordHash/i);
  });
});

describe("GET /api/admin/audit-logs", () => {
  it("records signup, booking, and cancellation actions", async () => {
    const resourceId = seedResource(db);
    const startAt = new Date(Date.now() + 3600_000).toISOString();
    const endAt = new Date(Date.now() + 7200_000).toISOString();
    const create = await request(app).post("/api/bookings").set("Authorization", `Bearer ${userToken}`).send({ resourceId, startAt, endAt });
    await request(app).post(`/api/bookings/${create.body.booking.id}/cancel`).set("Authorization", `Bearer ${userToken}`);

    const res = await request(app).get("/api/admin/audit-logs").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const actions = res.body.entries.map((e: any) => e.action);
    expect(actions).toContain("BOOKING_CREATED");
    expect(actions).toContain("BOOKING_CANCELLED");
    expect(JSON.stringify(res.body.entries)).not.toMatch(/passwordHash|passwordhash/i);
  });

  it("is not accessible to a regular user", async () => {
    const res = await request(app).get("/api/admin/audit-logs").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});
