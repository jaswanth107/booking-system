import type { ApiErrorBody, Booking, Resource, User } from "../types";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.code = body.error;
    this.status = status;
  }
}

// In dev, Vite proxies /api to the local backend. In production (frontend and
// backend deployed separately, e.g. Vercel + Render) this is set at build
// time to the backend's full URL, e.g. https://booking-backend.onrender.com/api.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

const TOKEN_KEY = "booking-system:token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined)
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, body as ApiErrorBody);
  }
  return body as T;
}

export const api = {
  signup: (name: string, email: string, password: string) =>
    request<{ user: User; token: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    }),
  login: (email: string, password: string) =>
    request<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),

  listResources: () => request<{ resources: Resource[] }>("/resources"),
  getResource: (id: string) => request<{ resource: Resource }>(`/resources/${id}`),
  checkAvailability: (id: string, startAt: string, endAt: string) =>
    request<{ available: boolean; advisory: boolean }>(
      `/resources/${id}/availability?startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`
    ),
  listMyBookings: () => request<{ bookings: Booking[] }>("/bookings"),
  createBooking: (resourceId: string, startAt: string, endAt: string) =>
    request<{ booking: Booking }>("/bookings", {
      method: "POST",
      body: JSON.stringify({ resourceId, startAt, endAt })
    }),
  cancelBooking: (id: string) =>
    request<{ booking: Booking }>(`/bookings/${id}/cancel`, { method: "POST" })
};
