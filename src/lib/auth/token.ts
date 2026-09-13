import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";

export interface SessionPayload {
  sub: string; // user id
  email: string;
  name: string;
  role: Role;
}

const COOKIE_NAME = "ems_session";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export function sessionCookieName() {
  return COOKIE_NAME;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const ttlHours = Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 12);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: String(payload.role) as Role,
    };
  } catch {
    return null;
  }
}
