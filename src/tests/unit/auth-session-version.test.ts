import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { isSessionCurrent, sessionCookieOptions, signSession, verifySession } from "@/lib/auth/token";

/**
 * Session invalidation rules.
 *
 * A password change (or admin removal) must stop previously issued tokens from working
 * without a session table: tokens carry the `User.sessionVersion` they were issued with
 * and the account is re-read on every request. These tests pin that contract, including
 * tokens minted before the field existed.
 */

const SECRET = "unit-test-secret-0123456789abcdef";

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("isSessionCurrent", () => {
  it("accepts a token whose epoch matches the stored version", () => {
    expect(isSessionCurrent({ sv: 3 }, { isActive: true, sessionVersion: 3 })).toBe(true);
  });

  it("rejects a token issued before a password change", () => {
    expect(isSessionCurrent({ sv: 2 }, { isActive: true, sessionVersion: 3 })).toBe(false);
  });

  it("rejects tokens for deactivated accounts", () => {
    expect(isSessionCurrent({ sv: 0 }, { isActive: false, sessionVersion: 0 })).toBe(false);
  });

  it("rejects tokens from the future (a rolled-back counter is never trusted)", () => {
    expect(isSessionCurrent({ sv: 5 }, { isActive: true, sessionVersion: 1 })).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips the session epoch", async () => {
    const token = await signSession({
      sub: "user-1",
      email: "user@example.edu",
      name: "Test User",
      role: "TEACHER",
      sv: 7,
    });
    const payload = await verifySession(token);
    expect(payload).toMatchObject({ sub: "user-1", role: "TEACHER", sv: 7 });
  });

  it("treats tokens minted before the epoch existed as version 0", async () => {
    const legacy = await new SignJWT({ sub: "user-2", email: "legacy@example.edu", name: "Legacy", role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));

    const payload = await verifySession(legacy);
    expect(payload?.sv).toBe(0);
    expect(isSessionCurrent({ sv: payload?.sv ?? -1 }, { isActive: true, sessionVersion: 0 })).toBe(true);
  });

  it("rejects tampered tokens", async () => {
    expect(await verifySession("not-a-token")).toBeNull();
  });

  it("keeps cookies httpOnly but not Secure outside production", () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBeGreaterThan(0);
    expect(options.secure).toBe(process.env.NODE_ENV === "production");
  });
});
