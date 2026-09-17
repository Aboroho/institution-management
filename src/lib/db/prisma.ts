import { PrismaClient } from "@prisma/client";
import { databaseUrlDiagnostic } from "./datasource-diagnostic";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Skip during `next build` (NEXT_PHASE is set there): build hosts routinely run without
// runtime environment variables, so only the running server should report on them.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (!isBuildPhase && process.env.NODE_ENV !== "test") {
  const problem = databaseUrlDiagnostic();
  if (problem) console.error(`[prisma] ${problem}`);
}

export default prisma;
