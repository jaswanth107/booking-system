import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { cancelBooking, createBooking, getBookingById, listBookings } from "../services/bookingService.js";
import { Errors } from "../services/errors.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export function bookingsRouter(db: DatabaseSync): Router {
  const router = Router();
  const auth = requireAuth(db);

  router.get("/", auth, (req, res, next) => {
    try {
      const bookings = listBookings(db, { userId: (req as AuthedRequest).userId });
      res.json({ bookings });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", auth, (req, res, next) => {
    try {
      const { resourceId, startAt, endAt } = req.body ?? {};
      const booking = createBooking(db, { resourceId, userId: (req as AuthedRequest).userId, startAt, endAt });
      res.status(201).json({ booking });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", auth, (req, res, next) => {
    try {
      const booking = getBookingById(db, req.params.id);
      if (!booking || booking.userId !== (req as AuthedRequest).userId) throw Errors.notFound("Booking");
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/cancel", auth, (req, res, next) => {
    try {
      const booking = cancelBooking(db, req.params.id, (req as AuthedRequest).userId);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
