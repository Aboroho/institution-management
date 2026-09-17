import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";

export interface SessionPayload {
  sub: string; // user id
  email: string;
  name: string;
  role: Role;
}

const COOKIE_NAME = "ems_session";

// Development-only fallback so the app runs out of the box without a .env file.
// Production must always provide a real AUTH_SECRET (>= 16 chars); otherwise
// token signing/verification fails fast instead of silently using a weak secret.
const DEV_FALLBACK_SECRET = "dev-secret-change-me-please-32";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) {
    return new TextEncoder().encode(s);
  }
  if (process.env.NODE_ENV !== "production") {
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  throw new Error("AUTH_SECRET is not configured");
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
