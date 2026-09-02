export type Role = "USER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "INACTIVE";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: AccountStatus;
  passwordChangeRequired: number; // SQLite has no boolean type; 0/1
  lastLoginAt: string | null;
  createdAt: string;
}

/** Never send passwordHash to a client. */
export type PublicUser = Omit<User, "passwordHash">;

export interface Session {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export interface PasswordReset {
  token: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export type ResourceStatus = "AVAILABLE" | "MAINTENANCE" | "DISABLED";

export interface Resource {
  id: string;
  name: string;
  location: string;
  bestForUse: string;
  description: string;
  capacity: number | null;
  facilities: string[];
  imageUrl: string | null;
  status: ResourceStatus;
  createdAt: string;
  updatedAt: string | null;
}

/** Row shape as stored in SQLite (facilities is a JSON string, not an array). */
export type ResourceRow = Omit<Resource, "facilities"> & { facilities: string };

export type BookingStatus = "CONFIRMED" | "CANCELLED";

export interface Booking {
  id: string;
  bookingRef: string;
  resourceId: string;
  userId: string;
  startAt: string; // ISO-8601 UTC
  endAt: string; // ISO-8601 UTC
  status: BookingStatus;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export interface BookingWithResource extends Booking {
  resourceName: string;
  resourceLocation: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string | null; // JSON string
  createdAt: string;
}
