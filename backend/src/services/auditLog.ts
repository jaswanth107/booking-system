import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { AuditLogEntry } from "../types.js";

export interface LogActionInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}

/** Never pass a password, hash, or reset token in `details`. */
export function logAction(db: DatabaseSync, input: LogActionInput): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actorId, actorEmail, action, entityType, entityId, details, createdAt)
     VALUES (@id, @actorId, @actorEmail, @action, @entityType, @entityId, @details, @createdAt)`
  ).run({
    id: randomUUID(),
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    details: input.details ? JSON.stringify(input.details) : null,
    createdAt: new Date().toISOString()
  });
}

export function listAuditLogs(db: DatabaseSync, limit = 300): AuditLogEntry[] {
  return db.prepare("SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT ?").all(limit) as unknown as AuditLogEntry[];
}
