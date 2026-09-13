import { describe, it, expect } from "vitest";
import { AppError, forbidden, approvalRequired } from "@/lib/errors/errors";

describe("error model", () => {
  it("carries code/status without internals", () => {
    const e = forbidden();
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("FORBIDDEN");
    expect(e.status).toBe(403);
    expect(e.message).not.toMatch(/prisma|sql|stack/i);
  });
  it("approval-required is distinguishable", () => {
    const e = approvalRequired();
    expect(e.code).toBe("APPROVAL_REQUIRED");
  });
});
