import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import {
  changePassword,
  getPublicUserById,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  signup
} from "../services/authService.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export function authRouter(db: DatabaseSync): Router {
  const router = Router();

  router.post("/signup", async (req, res, next) => {
    try {
      const { name, email, password, confirmPassword } = req.body ?? {};
      const result = await signup(db, { name, email, password, confirmPassword });
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

  // Reusable for both a normal "change my password" action and the forced
  // first-login change for the default admin (passwordChangeRequired flag).
  router.post("/change-password", requireAuth(db), async (req, res, next) => {
    try {
      const { currentPassword, newPassword, confirmPassword, name, email } = req.body ?? {};
      const user = await changePassword(db, (req as AuthedRequest).userId, {
        currentPassword,
        newPassword,
        confirmPassword,
        name,
        email
      });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  // Always the same response regardless of whether the email exists, to
  // avoid leaking account existence. See authService.requestPasswordReset.
  router.post("/forgot-password", async (req, res, next) => {
    try {
      await requestPasswordReset(db, req.body?.email);
      res.json({ message: "If that email is registered, a password reset link has been sent." });
    } catch (err) {
      next(err);
    }
  });

  router.post("/reset-password", async (req, res, next) => {
    try {
      const { token, newPassword, confirmPassword } = req.body ?? {};
      await resetPassword(db, { token, newPassword, confirmPassword });
      res.json({ message: "Password has been reset. You can now log in." });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
