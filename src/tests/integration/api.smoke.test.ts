import { describe, it, expect } from "vitest";

// Integration tests run against a real database (DATABASE_URL must point at a test DB).
// They are skipped in environments without one.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("api smoke (requires DATABASE_URL)", () => {
  it("imports prisma client", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    expect(prisma).toBeDefined();
  });
});
