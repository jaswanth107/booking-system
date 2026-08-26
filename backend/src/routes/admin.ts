import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middleware/auth.js";
import { getDashboardSummary } from "../services/dashboardService.js";
import { listUsersForAdmin, setUserStatus } from "../services/userAdminService.js";
import { adminCancelBooking, listBookingsForAdmin } from "../services/bookingService.js";
import { createResource, deleteResource, listResources, setResourceStatus, updateResource } from "../services/resourceService.js";
import { listAuditLogs, logAction } from "../services/auditLog.js";

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function adminRouter(db: DatabaseSync): Router {
  const router = Router();
  router.use(requireAuth(db), requireAdmin);

  router.get("/dashboard", (_req, res, next) => {
    try {
      res.json(getDashboardSummary(db));
    } catch (err) {
      next(err);
    }
  });

  // --- Users ---
  router.get("/users", (_req, res, next) => {
    try {
      res.json({ users: listUsersForAdmin(db) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/users/:id/status", (req, res, next) => {
    try {
      const adminId = (req as unknown as AuthedRequest).userId;
      setUserStatus(db, req.params.id, req.body?.status, adminId);
      logAction(db, {
        actorId: adminId,
        action: "USER_STATUS_CHANGED",
        entityType: "user",
        entityId: req.params.id,
        details: { status: req.body?.status }
      });
      res.json({ users: listUsersForAdmin(db) });
    } catch (err) {
      next(err);
    }
  });

  // --- Bookings ---
  router.get("/bookings", (req, res, next) => {
    try {
      const { q, date, resourceId, status, userId } = req.query as Record<string, string | undefined>;
      res.json({ bookings: listBookingsForAdmin(db, { q, date, resourceId, status, userId }) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/bookings/export.csv", (req, res, next) => {
    try {
      const { q, date, resourceId, status, userId } = req.query as Record<string, string | undefined>;
      const rows = listBookingsForAdmin(db, { q, date, resourceId, status, userId });
      const header = ["Booking ID", "User", "Email", "Resource", "Start", "End", "Status", "Created"];
      const lines = [header.join(",")];
      for (const b of rows) {
        lines.push(
          [b.bookingRef, b.userName, b.userEmail, b.resourceName, b.startAt, b.endAt, b.status, b.createdAt]
            .map(csvEscape)
            .join(",")
        );
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="bookings.csv"');
      res.send(lines.join("\n"));
    } catch (err) {
      next(err);
    }
  });

  router.post("/bookings/:id/cancel", (req, res, next) => {
    try {
      const adminId = (req as unknown as AuthedRequest).userId;
      const booking = adminCancelBooking(db, req.params.id, adminId);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  });

  // --- Resources ---
  router.get("/resources", (_req, res, next) => {
    try {
      res.json({ resources: listResources(db) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/resources", (req, res, next) => {
    try {
      const adminId = (req as unknown as AuthedRequest).userId;
      const resource = createResource(db, req.body ?? {});
      logAction(db, { actorId: adminId, action: "RESOURCE_CREATED", entityType: "resource", entityId: resource.id, details: { name: resource.name } });
      res.status(201).json({ resource });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/resources/:id", (req, res, next) => {
    try {
      const adminId = (req as unknown as AuthedRequest).userId;
      const resource = updateResource(db, req.params.id, req.body ?? {});
      logAction(db, { actorId: adminId, action: "RESOURCE_UPDATED", entityType: "resource", entityId: resource.id });
      res.json({ resource });
    } catch (err) {
      next(err);
    }
  });

  router.post("/resources/:id/status", (req, res, next) => {
    try {
      const adminId = (req as unknown as AuthedRequest).userId;
      const resource = setResourceStatus(db, req.params.id, req.body?.status);
      logAction(db, {
        actorId: adminId,
        action: "RESOURCE_STATUS_CHANGED",
        entityType: "resource",
        entityId: resource.id,
        details: { status: resource.status }
      });
      res.json({ resource });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/resources/:id", (req, res, next) => {
    try {
      const adminId = (req as unknown as AuthedRequest).userId;
      deleteResource(db, req.params.id);
      logAction(db, { actorId: adminId, action: "RESOURCE_DELETED", entityType: "resource", entityId: req.params.id });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // --- Audit log ---
  router.get("/audit-logs", (_req, res, next) => {
    try {
      res.json({ entries: listAuditLogs(db) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
