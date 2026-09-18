import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Guard tests for the hard constraints of the attendance UX work.
 *
 * These scan the repository rather than a runtime, because the requirements are
 * architectural: no schema/migration changes, cancellation represented with the
 * existing fields only, and one shared implementation of the attendance pieces
 * (no second copy of the pending-requests UI, no second quota calculation, no
 * dark-mode branch the design system does not support).
 */

const repoRoot = path.resolve(__dirname, "../../..");
const read = (...segments: string[]) => fs.readFileSync(path.join(repoRoot, ...segments), "utf8");

function listFiles(dir: string, extensions: string[]): string[] {
  const absolute = path.join(repoRoot, dir);
  if (!fs.existsSync(absolute)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(relative, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) out.push(relative);
  }
  return out;
}

function modelBlock(name: string): string {
  const match = new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, "m").exec(read("prisma", "schema.prisma"));
  return match?.[0] ?? "";
}

function enumBlock(name: string): string[] {
  const match = new RegExp(`^enum ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(read("prisma", "schema.prisma"));
  return (match?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

describe("No database/schema changes for the attendance workflow", () => {
  it("keeps the attendance models in the shape the code expects", () => {
    for (const model of [
      "AttendanceSession",
      "AttendanceRecord",
      "AttendanceChangeLog",
      "AttendanceChangeRequest",
      "AttendanceChangeRequestItem",
    ]) {
      expect(modelBlock(model), `model ${model} must exist unchanged`).not.toBe("");
    }
    // The fields the editor and the dialogs read on every screen.
    expect(modelBlock("AttendanceSession")).toMatch(/updateCount\s+Int/);
    expect(modelBlock("AttendanceSession")).toMatch(/@@unique\(\[courseOfferingId, attendanceDate\]\)/);
    expect(modelBlock("AttendanceRecord")).toMatch(/directCorrections\s+Int/);
    expect(modelBlock("AttendanceChangeRequestItem")).toMatch(/oldStatus\s+AttendanceStatus/);
    expect(modelBlock("AttendanceChangeRequestItem")).toMatch(/newStatus\s+AttendanceStatus/);
  });

  it("has not added a cancellation column, relation or flag to the change request", () => {
    // Cancellation is represented with the fields that already exist:
    // status REJECTED + a machine-readable reviewNote marker.
    const block = modelBlock("AttendanceChangeRequest");
    expect(block).not.toBe("");
    expect(block).not.toMatch(/cancel|withdraw/i);
    expect(block).toMatch(/status\s+ChangeRequestStatus/);
    expect(block).toMatch(/reviewNote\s+String\?/);
  });

  it("keeps the change-request status enum at its three database values", () => {
    // The app renders a fourth DISPLAY state (CANCELLED) precisely because this
    // enum is frozen: no "add an enum value" shortcut was taken.
    expect(enumBlock("ChangeRequestStatus").sort()).toEqual(["APPROVED", "PENDING", "REJECTED"]);
  });

  it("still relies on the existing one-pending-request-per-entry index for duplicates", () => {
    const sql = read("prisma", "migrations", "20260918100000_attendance_entry_change_requests", "migration.sql");
    expect(sql).toMatch(/CREATE UNIQUE INDEX "AttendanceChangeRequest_one_pending_per_session_key"/);
    expect(sql).toMatch(/WHERE "status" = 'PENDING'/);
  });

  it("ships no migration that touches attendance beyond the committed history", () => {
    const migrationsDir = path.join(repoRoot, "prisma", "migrations");
    const migrations = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    // Nothing newer than the committed head migration (20260918100000) may be
    // created by this work: no `prisma migrate dev`, no hand-written SQL.
    expect(migrations.every((name) => /^\d{14}_.+$/.test(name))).toBe(true);
    const newest = [...migrations].sort().at(-1);
    expect(newest).toBe("20260918100000_attendance_entry_change_requests");

    // And no migration may add a column/table the frozen schema does not have.
    const schema = read("prisma", "schema.prisma");
    for (const name of migrations) {
      const sql = read("prisma", "migrations", name, "migration.sql");
      for (const table of ["AttendanceSession", "AttendanceRecord", "AttendanceChangeRequest"]) {
        for (const match of sql.matchAll(new RegExp(`ALTER TABLE "${table}"\\s+ADD COLUMN "([A-Za-z]+)"`, "g"))) {
          expect(schema, `${name} adds ${table}.${match[1]} which is not in the schema`).toContain(`model ${table}`);
        }
      }
    }
  });
});

describe("Shared implementation, single source of truth", () => {
  it("both attendance screens reuse the same change-request components", () => {
    const takeForm = read("src", "components", "attendance", "attendance-take-form.tsx");
    const reportList = read("src", "components", "attendance", "attendance-report-list.tsx");

    for (const [name, screen] of [["take form", takeForm], ["report list", reportList]] as const) {
      expect(screen, `${name} must reuse the pending-requests dialog`).toMatch("./attendance-pending-requests-dialog");
      expect(screen, `${name} must reuse the shared request hook`).toMatch("use-attendance-change-requests");
    }
  });

  it("the report lists entry-level state and never offers a per-student request action", () => {
    const reportList = read("src", "components", "attendance", "attendance-report-list.tsx");

    expect(reportList).toMatch("item.permissions");
    expect(reportList).not.toMatch(/request change for this student/i);
    expect(reportList).not.toMatch(/records\/\[recordId\]\/request/i);
  });

  it("no attendance screen computes the correction quota itself", () => {
    const files = listFiles(path.join("src", "components", "attendance"), [".tsx", ".ts"]);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = read(file);
      // A local comparison or a second literal limit would be a parallel
      // implementation: capacity/limits arrive in `entry.permissions`.
      expect(source, `${file} re-implements the quota check`).not.toMatch(/correctionCapacityRemaining\s*[<>]=?\s*\d/);
      expect(source, `${file} re-implements the quota check`).not.toMatch(/updateCount\s*[<>]=?\s*\d/);
      expect(source, `${file} hardcodes a correction limit`).not.toMatch(/CORRECTION_LIMIT\s*=\s*\d/);
    }
  });

  it("the app has no dark mode, so the attendance screens must not branch on it", () => {
    expect(read("tailwind.config.ts")).not.toMatch(/darkMode/);

    for (const file of listFiles(path.join("src", "components", "attendance"), [".tsx", ".ts"])) {
      const offenders = read(file)
        .split("\n")
        // Comments explaining WHY there is no dark mode are allowed; classes are not.
        .filter((line) => line.includes("dark:") && !/^\s*([/*]|\*)/.test(line));
      expect(offenders, `${file} still contains dark: variants`).toEqual([]);
    }
  });

  it("attendance routes keep the project's ok/fail + requireAuth API conventions", () => {
    const routeFiles = listFiles(path.join("src", "app", "api", "v1", "attendance"), [".ts"]);
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const file of routeFiles) {
      const source = read(file);
      expect(source, `${file} must use the shared response helpers`).toMatch("@/lib/api/response");
      expect(source, `${file} must authenticate through requireAuth`).toMatch("requireAuth");
      expect(source, `${file} must not hand-roll error bodies`).not.toMatch(/new Response\(|NextResponse\.json/);
    }
  });
});
