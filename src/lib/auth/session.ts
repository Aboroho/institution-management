import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sessionCookieName, sessionVersionMatches, signSession, verifySession, type SessionPayload } from "./token";
import { unauthorized } from "@/lib/errors/errors";

export interface AuthContext {
  session: SessionPayload;
  userId: string;
  role: SessionPayload["role"];
}

export async function getAuth(): Promise<AuthContext | null> {
  const jar = cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, isActive: true, role: true, tokenVersion: true },
  });
  if (!user || !user.isActive) return null;
  // Revocation for stateless JWTs: tokens stamped with an older tokenVersion
  // (e.g. issued before a password change) are no longer accepted.
  if (!sessionVersionMatches(session, user)) return null;
  return { session: { ...session, role: user.role }, userId: user.id, role: user.role };
}

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw unauthorized();
  return auth;
}

export function requestMeta() {
  const h = headers();
  return {
    ip:
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null,
    userAgent: h.get("user-agent"),
  };
}

/** DB-shaped user row needed to issue a session token. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tokenVersion: number;
}

/** Signs a fresh session token for the given (server-read) user row. */
export function signSessionForUser(user: SessionUser): Promise<string> {
  return signSession({ sub: user.id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion });
}

/** Attaches the session cookie to a response — shared by login and post-change refresh. */
export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 12),
  });
}
