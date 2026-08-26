import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { DatabaseSync } from "node:sqlite";
import { resourcesRouter } from "./routes/resources.js";
import { bookingsRouter } from "./routes/bookings.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { AppError } from "./services/errors.js";

export function createApp(db: DatabaseSync): Express {
  const app = express();

  // CORS_ORIGIN, if set, restricts which frontend origin(s) may call the API
  // (comma-separated). Unset (local dev) allows any origin. Auth uses bearer
  // tokens, not cookies, so this is a hygiene measure rather than a CSRF
  // defense — a stolen token isn't obtainable via cross-origin requests.
  const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/resources", resourcesRouter(db));
  app.use("/api/bookings", bookingsRouter(db));
  app.use("/api/auth", authRouter(db));
  app.use("/api/admin", adminRouter(db));

  app.use((req, res) => {
    res.status(404).json({ error: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` });
  });

  // Centralized error handler: AppError -> structured JSON with the right
  // status code. Anything else is an unexpected bug — log it server-side
  // and return a generic 500 without leaking internals to the client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong. Please try again." });
  });

  return app;
}
