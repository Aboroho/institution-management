import { describe, expect, it } from "vitest";
import { createAdminSchema, normalizeEmail, passwordChangeSchema, profileUpdateSchema } from "@/lib/validation/users";

describe("normalizeEmail — matches the login normalization", () => {
  it("trims and lowercases so case variants never create duplicate accounts", () => {
    expect(normalizeEmail("  Alice@Institution.LOCAL  ")).toBe("alice@institution.local");
    expect(normalizeEmail("admin@institution.local")).toBe("admin@institution.local");
  });
});

describe("profileUpdateSchema", () => {
  it("accepts a name change", () => {
    expect(profileUpdateSchema.safeParse({ name: "Alice Teacher" }).success).toBe(true);
  });
  it("accepts an email change", () => {
    expect(profileUpdateSchema.safeParse({ email: "alice@example.edu" }).success).toBe(true);
  });
  it("rejects an empty update", () => {
    const r = profileUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
  });
  it("rejects names outside 2–80 characters", () => {
    expect(profileUpdateSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("rejects malformed emails", () => {
    expect(profileUpdateSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("mass-assignment: 'role' cannot be set from the client", () => {
    const r = profileUpdateSchema.safeParse({ name: "Hacker", role: "ADMIN" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.role?.join(" ")).toMatch(/system-managed/i);
    }
  });
  it("mass-assignment: 'isSeedAdmin' cannot be set from the client", () => {
    const r = profileUpdateSchema.safeParse({ name: "Wannabe", isSeedAdmin: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.isSeedAdmin?.join(" ")).toMatch(/system-managed/i);
    }
  });
  it("mass-assignment: 'isActive', 'passwordHash', 'tokenVersion' and 'id' are rejected", () => {
    for (const body of [
      { isActive: false },
      { passwordHash: "$2a$12$nope" },
      { tokenVersion: 99 },
      { id: "someone-else" },
      { userId: "someone-else" },
      { permissions: ["*"] },
    ]) {
      expect(profileUpdateSchema.safeParse({ name: "X", ...body }).success).toBe(false);
    }
  });
});

describe("passwordChangeSchema", () => {
  const valid = { currentPassword: "OldPass1!", newPassword: "NewPass123!", confirmPassword: "NewPass123!" };
  it("accepts a valid change request", () => {
    expect(passwordChangeSchema.safeParse(valid).success).toBe(true);
  });
  it("requires the current password", () => {
    expect(passwordChangeSchema.safeParse({ ...valid, currentPassword: "" }).success).toBe(false);
  });
  it("enforces the existing minimum-length policy", () => {
    const r = passwordChangeSchema.safeParse({ ...valid, newPassword: "short", confirmPassword: "short" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.newPassword?.join(" ")).toMatch(/at least 8/i);
  });
  it("requires confirmation to match", () => {
    const r = passwordChangeSchema.safeParse({ ...valid, confirmPassword: "Different1!" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.confirmPassword?.join(" ")).toMatch(/do not match/i);
  });
  it("rejects protected fields", () => {
    expect(passwordChangeSchema.safeParse({ ...valid, isSeedAdmin: true }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ ...valid, tokenVersion: 5 }).success).toBe(false);
  });
});

describe("createAdminSchema", () => {
  const valid = { name: "New Admin", email: "new.admin@example.edu", password: "Init1234!" };
  it("accepts name/email/initial password only", () => {
    expect(createAdminSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a client-supplied role", () => {
    expect(createAdminSchema.safeParse({ ...valid, role: "STUDENT" }).success).toBe(false);
  });
  it("rejects an attempted seed-admin elevation", () => {
    const r = createAdminSchema.safeParse({ ...valid, isSeedAdmin: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.isSeedAdmin?.join(" ")).toMatch(/system-managed/i);
  });
  it("rejects an invalid email and weak passwords", () => {
    expect(createAdminSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
    expect(createAdminSchema.safeParse({ ...valid, password: "1234567" }).success).toBe(false);
  });
});
