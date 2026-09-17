import { describe, expect, it } from "vitest";
import { databaseUrlDiagnostic } from "@/lib/db/datasource-diagnostic";

// The diagnostic reports only the URL scheme (never credentials) and must stay silent for a
// direct PostgreSQL connection so it does not add noise to healthy deployments.
describe("DATABASE_URL startup diagnostic", () => {
  it("accepts postgresql:// and postgres:// without reporting anything", () => {
    expect(databaseUrlDiagnostic("postgresql://ems:secret@db:5432/ems?schema=public")).toBeNull();
    expect(databaseUrlDiagnostic("postgres://ems:secret@db:5432/ems")).toBeNull();
  });

  it("reports a missing DATABASE_URL", () => {
    expect(databaseUrlDiagnostic(undefined)).toMatch(/not set/);
    expect(databaseUrlDiagnostic("")).toMatch(/not set/);
  });

  it("reports the Prisma Accelerate scheme, which this deployment does not use", () => {
    expect(databaseUrlDiagnostic("prisma://accelerate.prisma-data.net/?api_key=secret")).toMatch(
      /"prisma:"/,
    );
  });

  it("reports an unparseable value without echoing it", () => {
    const problem = databaseUrlDiagnostic("not-a-url");
    expect(problem).toMatch(/not a valid URL/);
    expect(problem).not.toContain("not-a-url");
  });
});
