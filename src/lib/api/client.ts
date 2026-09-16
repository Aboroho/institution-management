"use client";
import { validationMessage } from "@/lib/validation/form-errors";
// Centralized API client. All UI data flows through here — no scattered fetch calls.

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(status >= 500 ? "We couldn’t complete your request. Please try again shortly." : code === "VALIDATION_ERROR" ? validationMessage(details, message) : message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function handle<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(err.code || "INTERNAL_ERROR", err.message || (res.status === 401 ? "Your session has expired. Please sign in again." : res.status === 403 ? "You don’t have permission to perform this action." : "The request could not be completed. Please try again."), res.status, err.details);
  }
  return json as { data: T; meta?: Record<string, unknown> };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<{ data: T; meta?: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Unable to connect. Check your connection and try again.", 0);
  }
  return handle<T>(res);
}

export const get = <T,>(path: string) => apiFetch<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T,>(path: string) => apiFetch<T>(path, { method: "DELETE" });

export function qs(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : "";
}

// Resource clients
export interface MyProfile {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "TEACHER" | "STUDENT";
  isActive: boolean;
  isSeedAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  student?: { id: string; studentId: string } | null;
  teacher?: { id: string; employeeId: string } | null;
}

export interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: "ADMIN";
  isActive: boolean;
  isSeedAdmin: boolean;
  createdAt: string;
  updatedAt?: string;
}

export const authApi = {
  me: () => get<{ id: string; email: string; name: string; role: string; isSeedAdmin?: boolean; student?: { id: string; studentId: string } | null; teacher?: { id: string; employeeId: string } | null }>("/auth/me"),
  login: (email: string, password: string) => post<{ id: string; email: string; name: string; role: string }>("/auth/login", { email, password }),
  logout: () => post("/auth/logout"),
};

export const accountApi = {
  profile: () => get<MyProfile>("/users/me"),
  updateProfile: (body: { name?: string; email?: string }) => patch<MyProfile>("/users/me", body),
  changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    post<{ changed: boolean }>("/users/me/change-password", body),
};

export const adminUsersApi = {
  list: (params: Record<string, string | number | undefined | null> = {}) => get<AdminRow[]>(`/users${qs({ adminsOnly: "true", ...params })}`),
  create: (body: { name: string; email: string; password: string }) => post<AdminRow>("/users", body),
  remove: (id: string) => del<{ id: string; deleted: boolean }>(`/users/${id}`),
};

export const buildList = (resource: string) => (params: Record<string, string | number | undefined | null> = {}) =>
  get<unknown[]>(`/${resource}${qs(params)}`);
