/**
 * Safe datasource diagnostic (no credentials, no query string): hosting panels such as
 * Hostinger make it easy to deploy with a missing/renamed DATABASE_URL or with the Prisma
 * Accelerate scheme where a direct PostgreSQL connection is intended. The datasource is
 * declared as `env("DATABASE_URL")` in prisma/schema.prisma, so the scheme is all we need
 * to report.
 *
 * Returns a human-readable problem description, or null when the value looks usable.
 */
export function databaseUrlDiagnostic(raw = process.env.DATABASE_URL): string | null {
  if (!raw) return "DATABASE_URL is not set — Prisma cannot connect to PostgreSQL.";
  let scheme: string;
  try {
    scheme = new URL(raw).protocol;
  } catch {
    return "DATABASE_URL is not a valid URL.";
  }
  if (scheme !== "postgresql:" && scheme !== "postgres:") {
    return (
      `DATABASE_URL uses the "${scheme}" scheme but this deployment is configured for direct ` +
      "PostgreSQL access (postgresql://). Queries will fail until it is corrected."
    );
  }
  return null;
}
