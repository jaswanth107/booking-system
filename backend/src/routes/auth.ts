import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { getPublicUserById, login, logout, signup } from "../services/authService.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export function authRouter(db: DatabaseSync): Router {
  const router = Router();

  router.post("/signup", async (req, res, next) => {
    try {
      const { name, email, password } = req.body ?? {};
      const result = await signup(db, { name, email, password });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      const result = await login(db, { email, password });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", requireAuth(db), (req, res, next) => {
    try {
      const header = req.header("authorization") ?? "";
      const token = header.split(" ")[1];
      if (token) logout(db, token);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", requireAuth(db), (req, res, next) => {
    try {
      const user = getPublicUserById(db, (req as AuthedRequest).userId);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
