import type { DatabaseSync } from "node:sqlite";
import type { NextFunction, Request, Response } from "express";
import { getUserByToken } from "../services/authService.js";
import { Errors } from "../services/errors.js";
import type { PublicUser } from "../types.js";

export interface AuthedRequest extends Request {
  userId: string;
  user: PublicUser;
}

function extractToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/** Resolves the bearer token to a real user server-side; never trusts a client-supplied id. */
export function requireAuth(db: DatabaseSync) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) return next(Errors.unauthorized());
    const user = getUserByToken(db, token);
    if (!user) return next(Errors.unauthorized());
    (req as AuthedRequest).userId = user.id;
    (req as AuthedRequest).user = user;
    next();
  };
}

/** Must run after requireAuth(db). Backend-enforced — never trust a frontend role check. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const user = (req as AuthedRequest).user;
  if (!user || user.role !== "ADMIN") return next(Errors.forbidden("Admin access is required."));
  next();
}
