import type { DatabaseSync } from "node:sqlite";
import { Errors } from "./errors.js";
import type { AccountStatus } from "../types.js";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  bookingCount: number;
}

/** Never selects passwordHash — admins can see everything about a user
 * except their credentials. */
export function listUsersForAdmin(db: DatabaseSync): AdminUserRow[] {
  return db
    .prepare(
      `SELECT users.id, users.name, users.email, users.role, users.status,
              users.createdAt, users.lastLoginAt,
              (SELECT COUNT(*) FROM bookings WHERE bookings.userId = users.id) as bookingCount
       FROM users
       ORDER BY users.createdAt DESC`
    )
    .all() as unknown as AdminUserRow[];
}

const VALID_STATUSES: AccountStatus[] = ["ACTIVE", "INACTIVE"];

export function setUserStatus(db: DatabaseSync, targetUserId: string, status: unknown, actingAdminId: string): void {
  if (typeof status !== "string" || !VALID_STATUSES.includes(status as AccountStatus)) {
    throw Errors.invalidInput(`Status must be one of ${VALID_STATUSES.join(", ")}.`);
  }
  if (targetUserId === actingAdminId && status === "INACTIVE") {
    throw Errors.invalidInput("You cannot deactivate your own account.");
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
  if (!user) throw Errors.notFound("User");

  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, targetUserId);
}
