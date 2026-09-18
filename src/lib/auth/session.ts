import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { isSessionCurrent, sessionCookieName, verifySession, type SessionPayload } from "./token";
import { unauthorized } from "@/lib/errors/errors";

export interface AuthContext {
  session: SessionPayload;
  userId: string;
  role: SessionPayload["role"];
  /**
   * Session epoch currently stored for the account. Re-issue the session with
   * `sessionTokenFor` after a credential change so the caller's own session stays
   * valid while every other token for the account is invalidated.
   */
  sessionVersion: number;
  /** Persisted marker of the protected seed admin (server-side truth, never client input). */
  isProtectedSeedAdmin: boolean;
}

export async function getAuth(): Promise<AuthContext | null> {
  const jar = cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      isActive: true,
      role: true,
      sessionVersion: true,
      isProtectedSeedAdmin: true,
      email: true,
      name: true,
    },
  });
  // Deactivated accounts and sessions superseded by a credential change (password
  // change, admin removal) stop working immediately — no session table needed.
  if (!user || !isSessionCurrent(session, user)) return null;
  return {
    session: { ...session, role: user.role, email: user.email, name: user.name, sv: user.sessionVersion },
    userId: user.id,
    role: user.role,
    sessionVersion: user.sessionVersion,
    isProtectedSeedAdmin: user.isProtectedSeedAdmin,
  };
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
