export type Role = "USER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "INACTIVE";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
  passwordChangeRequired: number;
  lastLoginAt: string | null;
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

export type BookingStatus = "CONFIRMED" | "CANCELLED";

export interface Booking {
  id: string;
  bookingRef: string;
  resourceId: string;
  userId: string;
  startAt: string; // UTC ISO-8601
  endAt: string; // UTC ISO-8601
  status: BookingStatus;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export interface AdminBooking extends Booking {
  userName: string;
  userEmail: string;
  resourceName: string;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
  createdAt: string;
  lastLoginAt: string | null;
  bookingCount: number;
}

export interface DashboardSummary {
  totalUsers: number;
  totalResources: number;
  availableResources: number;
  todaysBookings: number;
  upcomingBookings: number;
  cancelledBookings: number;
  mostBookedResource: { id: string; name: string; count: number } | null;
  leastBookedResource: { id: string; name: string; count: number } | null;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
