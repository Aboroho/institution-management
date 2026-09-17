import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { sessionCookieName, verifySession, type SessionPayload } from "./token";
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
    select: { id: true, isActive: true, role: true },
  });
  if (!user || !user.isActive) return null;
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
