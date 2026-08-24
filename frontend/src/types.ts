export interface User {
  id: string;
  name: string;
  email: string;
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
  startAt: string; // UTC ISO-8601
  endAt: string; // UTC ISO-8601
  status: BookingStatus;
  createdAt: string;
  cancelledAt: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
