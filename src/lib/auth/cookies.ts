import type { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { sessionCookieName, sessionCookieOptions, signSession } from "./token";

/**
 * Session cookie plumbing shared by the login and credential-refresh flows.
 *
 * Kept separate from `session.ts` (which reads the incoming request via `next/headers`)
 * so it can be used by any route handler — and exercised directly in tests — without a
 * request scope.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  sessionVersion: number;
}

/** Builds a session token that carries the account's current session epoch. */
export function sessionTokenFor(user: SessionUser): Promise<string> {
  return signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sv: user.sessionVersion,
  });
}

/** Rotates the session cookie (login, profile update, password change). */
export function applySessionCookie<T extends NextResponse>(res: T, token: string): T {
  res.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  return res;
}

/** Removes the session cookie (logout, deleted/inactive accounts). */
export function clearSessionCookie<T extends NextResponse>(res: T): T {
  res.cookies.set(sessionCookieName(), "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
