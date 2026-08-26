import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Resource, ResourceRow, ResourceStatus } from "../types.js";
import { Errors } from "./errors.js";

const VALID_STATUSES: ResourceStatus[] = ["AVAILABLE", "MAINTENANCE", "DISABLED"];

function rowToResource(row: ResourceRow): Resource {
  let facilities: string[] = [];
  try {
    const parsed = JSON.parse(row.facilities);
    if (Array.isArray(parsed)) facilities = parsed.filter((f) => typeof f === "string");
  } catch {
    facilities = [];
  }
  return { ...row, facilities };
}

export function getResourceById(db: DatabaseSync, id: string): Resource | undefined {
  const row = db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as ResourceRow | undefined;
  return row ? rowToResource(row) : undefined;
}

export interface ResourceFilters {
  q?: string;
  status?: string;
  minCapacity?: number;
  facilities?: string[];
}

/** Fetches everything matching the cheap SQL filters, then applies facilities
 * (stored as a JSON string) and capacity filtering in JS — the resource
 * catalogue is small, so this stays simple and correct rather than fighting
 * SQLite's lack of JSON containment operators. */
export function listResources(db: DatabaseSync, filters: ResourceFilters = {}): Resource[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (filters.q) {
    clauses.push("(name LIKE @q OR location LIKE @q OR bestForUse LIKE @q OR description LIKE @q)");
    params.q = `%${filters.q}%`;
  }
  if (filters.status) {
    clauses.push("status = @status");
    params.status = filters.status;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM resources ${where} ORDER BY name ASC`).all(params) as unknown as ResourceRow[];
  let resources = rows.map(rowToResource);

  if (typeof filters.minCapacity === "number") {
    resources = resources.filter((r) => (r.capacity ?? 0) >= filters.minCapacity!);
  }
  if (filters.facilities?.length) {
    const wanted = filters.facilities.map((f) => f.toLowerCase());
    resources = resources.filter((r) => {
      const have = r.facilities.map((f) => f.toLowerCase());
      return wanted.every((w) => have.includes(w));
    });
  }

  return resources;
}

interface ResourceInput {
  name: unknown;
  location: unknown;
  bestForUse: unknown;
  description: unknown;
  capacity?: unknown;
  facilities?: unknown;
  imageUrl?: unknown;
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function validateRequiredFields(input: ResourceInput) {
  if (isBlank(input.name)) throw Errors.invalidInput("Place name is required.");
  if (isBlank(input.location)) throw Errors.invalidInput("Landmark is required.");
  if (isBlank(input.bestForUse)) throw Errors.invalidInput("\"Best for use\" is required.");
  if (isBlank(input.description)) throw Errors.invalidInput("Description is required.");
}

function normalizeCapacity(capacity: unknown): number | null {
  if (capacity === undefined || capacity === null || capacity === "") return null;
  const n = Number(capacity);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw Errors.invalidInput("Capacity must be a whole number of 0 or more.");
  }
  return n;
}

function normalizeFacilities(facilities: unknown): string[] {
  if (facilities === undefined || facilities === null) return [];
  if (!Array.isArray(facilities)) throw Errors.invalidInput("Facilities must be a list of strings.");
  return facilities.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim());
}

export function createResource(db: DatabaseSync, input: ResourceInput): Resource {
  validateRequiredFields(input);
  const capacity = normalizeCapacity(input.capacity);
  const facilities = normalizeFacilities(input.facilities);
  const imageUrl = typeof input.imageUrl === "string" && input.imageUrl.trim() ? input.imageUrl.trim() : null;

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO resources (id, name, location, bestForUse, description, capacity, facilities, imageUrl, status, createdAt, updatedAt)
     VALUES (@id, @name, @location, @bestForUse, @description, @capacity, @facilities, @imageUrl, 'AVAILABLE', @createdAt, NULL)`
  ).run({
    id,
    name: (input.name as string).trim(),
    location: (input.location as string).trim(),
    bestForUse: (input.bestForUse as string).trim(),
    description: (input.description as string).trim(),
    capacity,
    facilities: JSON.stringify(facilities),
    imageUrl,
    createdAt
  });

  return getResourceById(db, id)!;
}

export function updateResource(db: DatabaseSync, id: string, input: Partial<ResourceInput>): Resource {
  const existing = getResourceById(db, id);
  if (!existing) throw Errors.notFound("Resource");

  const merged: ResourceInput = {
    name: input.name ?? existing.name,
    location: input.location ?? existing.location,
    bestForUse: input.bestForUse ?? existing.bestForUse,
    description: input.description ?? existing.description,
    capacity: input.capacity !== undefined ? input.capacity : existing.capacity,
    facilities: input.facilities !== undefined ? input.facilities : existing.facilities,
    imageUrl: input.imageUrl !== undefined ? input.imageUrl : existing.imageUrl
  };
  validateRequiredFields(merged);
  const capacity = normalizeCapacity(merged.capacity);
  const facilities = normalizeFacilities(merged.facilities);
  const imageUrl = typeof merged.imageUrl === "string" && merged.imageUrl.trim() ? merged.imageUrl.trim() : null;

  db.prepare(
    `UPDATE resources SET name = @name, location = @location, bestForUse = @bestForUse,
       description = @description, capacity = @capacity, facilities = @facilities,
       imageUrl = @imageUrl, updatedAt = @updatedAt
     WHERE id = @id`
  ).run({
    id,
    name: (merged.name as string).trim(),
    location: (merged.location as string).trim(),
    bestForUse: (merged.bestForUse as string).trim(),
    description: (merged.description as string).trim(),
    capacity,
    facilities: JSON.stringify(facilities),
    imageUrl,
    updatedAt: new Date().toISOString()
  });

  return getResourceById(db, id)!;
}

export function setResourceStatus(db: DatabaseSync, id: string, status: unknown): Resource {
  if (typeof status !== "string" || !VALID_STATUSES.includes(status as ResourceStatus)) {
    throw Errors.invalidInput(`Status must be one of ${VALID_STATUSES.join(", ")}.`);
  }
  const existing = getResourceById(db, id);
  if (!existing) throw Errors.notFound("Resource");

  db.prepare("UPDATE resources SET status = ?, updatedAt = ? WHERE id = ?").run(
    status,
    new Date().toISOString(),
    id
  );
  return getResourceById(db, id)!;
}

/** Refuses to delete a resource that any booking (past or present) references,
 * so historical booking records never dangle. Callers should Disable instead. */
export function deleteResource(db: DatabaseSync, id: string): void {
  const existing = getResourceById(db, id);
  if (!existing) throw Errors.notFound("Resource");

  const bookingCount = (
    db.prepare("SELECT COUNT(*) as c FROM bookings WHERE resourceId = ?").get(id) as { c: number }
  ).c;
  if (bookingCount > 0) throw Errors.resourceHasBookings();

  db.prepare("DELETE FROM resources WHERE id = ?").run(id);
}
