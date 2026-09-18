import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";

export interface SessionPayload {
  sub: string; // user id
  email: string;
  name: string;
  role: Role;
  /**
   * Session epoch (`User.sessionVersion`) the token was issued with. Every credential
   * or access change increments the stored value, so tokens issued earlier stop
   * matching and are rejected by `requireAuth` even though they are still signed.
   * Tokens minted before this field existed are treated as version 0.
   */
  sv: number;
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
      sv: Number.isFinite(Number(payload.sv)) ? Number(payload.sv) : 0,
    };
  } catch {
    return null;
  }
}

/**
 * True when a verified token still belongs to the current state of the account.
 * Pure and dependency-free so it can be unit tested and reused anywhere a session
 * is validated (route handlers today, middleware/edge later).
 */
export function isSessionCurrent(
  session: Pick<SessionPayload, "sv">,
  user: { isActive: boolean; sessionVersion: number },
): boolean {
  return user.isActive && (session.sv ?? 0) === user.sessionVersion;
}

/** Cookie attributes shared by the login and credential-refresh flows. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 12),
  };
}
