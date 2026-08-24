export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

/** Never send passwordHash to a client. */
export type PublicUser = Omit<User, "passwordHash">;

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
}

export interface Resource {
  id: string;
  name: string;
  description: string;
  location: string;
  capacity: number;
  createdAt: string;
}

export type BookingStatus = "CONFIRMED" | "CANCELLED";

export interface Booking {
  id: string;
  resourceId: string;
  userId: string;
  startAt: string; // ISO-8601 UTC
  endAt: string; // ISO-8601 UTC
  status: BookingStatus;
  createdAt: string;
  cancelledAt: string | null;
}
