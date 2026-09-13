"use client";
// Centralized API client. All UI data flows through here — no scattered fetch calls.

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function handle<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(err.code || "INTERNAL_ERROR", err.message || `Request failed (${res.status})`, res.status, err.details);
  }
  return json as { data: T; meta?: Record<string, unknown> };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
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
export const authApi = {
  me: () => get<{ id: string; email: string; name: string; role: string; student?: { id: string; studentId: string } | null; teacher?: { id: string; employeeId: string } | null }>("/auth/me"),
  login: (email: string, password: string) => post<{ id: string; email: string; name: string; role: string }>("/auth/login", { email, password }),
  logout: () => post("/auth/logout"),
};

export const buildList = (resource: string) => (params: Record<string, string | number | undefined | null> = {}) =>
  get<unknown[]>(`/${resource}${qs(params)}`);
