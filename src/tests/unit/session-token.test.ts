import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { sessionVersionMatches, signSession, verifySession } from "@/lib/auth/token";

describe("session token versioning (password-change revocation)", () => {
  it("round-trips the tokenVersion claim", async () => {
    const token = await signSession({ sub: "u1", email: "a@b.c", name: "A", role: "ADMIN", tokenVersion: 3 });
    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("u1");
    expect(payload?.tokenVersion).toBe(3);
  });

  it("treats legacy tokens without a version claim as version 0", async () => {
    // Simulates a cookie issued before session-versioning support was added.
    const legacy = await new SignJWT({ sub: "u2", email: "b@b.c", name: "B", role: "TEACHER" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me-please-32"));
    const payload = await verifySession(legacy);
    expect(payload?.tokenVersion).toBe(0);
    expect(sessionVersionMatches(payload!, { tokenVersion: 0 })).toBe(true);
    // After a password change bumps the user to version 1 the stale token is dead.
    expect(sessionVersionMatches(payload!, { tokenVersion: 1 })).toBe(false);
  });

  it("matches only exact versions", () => {
    expect(sessionVersionMatches({ tokenVersion: 2 }, { tokenVersion: 2 })).toBe(true);
    expect(sessionVersionMatches({ tokenVersion: 1 }, { tokenVersion: 2 })).toBe(false);
    expect(sessionVersionMatches({ tokenVersion: 3 }, { tokenVersion: 2 })).toBe(false);
  });
});
