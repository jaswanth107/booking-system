import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { checkAvailability, getResourceById, listResources } from "../services/bookingService.js";
import { Errors } from "../services/errors.js";
import { parseTimestamp } from "../utils/time.js";

export function resourcesRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ resources: listResources(db) });
  });

  router.get("/:id", (req, res, next) => {
    try {
      const resource = getResourceById(db, req.params.id);
      if (!resource) throw Errors.notFound("Resource");
      res.json({ resource });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/availability", (req, res, next) => {
    try {
      const resource = getResourceById(db, req.params.id);
      if (!resource) throw Errors.notFound("Resource");

      const startAt = parseTimestamp(req.query.startAt);
      const endAt = parseTimestamp(req.query.endAt);
      if (!startAt || !endAt) {
        throw Errors.invalidInput("startAt and endAt query params are required valid timestamps.");
      }
      if (startAt.getTime() >= endAt.getTime()) {
        throw Errors.invalidRange("startAt must be before endAt.");
      }

      const result = checkAvailability(db, resource.id, startAt, endAt);
      res.json({ ...result, advisory: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
