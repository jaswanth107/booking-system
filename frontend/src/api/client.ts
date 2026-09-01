import type {
  AdminBooking,
  AdminUserRow,
  ApiErrorBody,
  AuditLogEntry,
  Booking,
  DashboardSummary,
  Resource,
  User
} from "../types";

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

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

export interface AdminBookingFilters {
  q?: string;
  date?: string;
  resourceId?: string;
  status?: string;
  userId?: string;
}

export interface ResourceFilters {
  q?: string;
  status?: string;
  minCapacity?: number;
  facilities?: string;
}

export interface ResourceInput {
  name: string;
  location: string;
  bestForUse: string;
  description: string;
  capacity?: number | null;
  facilities?: string[];
  imageUrl?: string | null;
}

export const api = {
  signup: (name: string, email: string, password: string, confirmPassword: string) =>
    request<{ user: User; token: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password, confirmPassword })
    }),
  login: (email: string, password: string) =>
    request<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),
  changePassword: (
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
    profile?: { name: string; email: string }
  ) =>
    request<{ user: User }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword,
        newPassword,
        confirmPassword,
        name: profile?.name,
        email: profile?.email
      })
    }),
  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  resetPassword: (token: string, newPassword: string, confirmPassword: string) =>
    request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword, confirmPassword })
    }),

  listResources: (filters: ResourceFilters = {}) =>
    request<{ resources: Resource[] }>(`/resources${toQuery(filters)}`),
  getResource: (id: string) => request<{ resource: Resource }>(`/resources/${id}`),
  checkAvailability: (id: string, startAt: string, endAt: string) =>
    request<{ available: boolean; advisory: boolean; resourceStatus: string }>(
      `/resources/${id}/availability?startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`
    ),
  listMyBookings: () => request<{ bookings: Booking[] }>("/bookings"),
  createBooking: (resourceId: string, startAt: string, endAt: string) =>
    request<{ booking: Booking }>("/bookings", {
      method: "POST",
      body: JSON.stringify({ resourceId, startAt, endAt })
    }),
  cancelBooking: (id: string) =>
    request<{ booking: Booking }>(`/bookings/${id}/cancel`, { method: "POST" }),

  // --- Admin ---
  admin: {
    dashboard: () => request<DashboardSummary>("/admin/dashboard"),

    listUsers: () => request<{ users: AdminUserRow[] }>("/admin/users"),
    setUserStatus: (id: string, status: "ACTIVE" | "INACTIVE") =>
      request<{ users: AdminUserRow[] }>(`/admin/users/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status })
      }),

    listBookings: (filters: AdminBookingFilters = {}) =>
      request<{ bookings: AdminBooking[] }>(`/admin/bookings${toQuery(filters)}`),
    cancelBooking: (id: string) =>
      request<{ booking: Booking }>(`/admin/bookings/${id}/cancel`, { method: "POST" }),
    exportBookingsCsv: async (filters: AdminBookingFilters = {}): Promise<Blob> => {
      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/bookings/export.csv${toQuery(filters)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error("Export failed");
      return res.blob();
    },

    listResources: () => request<{ resources: Resource[] }>("/admin/resources"),
    createResource: (input: ResourceInput) =>
      request<{ resource: Resource }>("/admin/resources", { method: "POST", body: JSON.stringify(input) }),
    updateResource: (id: string, input: Partial<ResourceInput>) =>
      request<{ resource: Resource }>(`/admin/resources/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    setResourceStatus: (id: string, status: string) =>
      request<{ resource: Resource }>(`/admin/resources/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status })
      }),
    deleteResource: (id: string) => request<void>(`/admin/resources/${id}`, { method: "DELETE" }),

    listAuditLogs: () => request<{ entries: AuditLogEntry[] }>("/admin/audit-logs")
  }
};
