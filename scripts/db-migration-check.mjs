#!/usr/bin/env node
/**
 * Fail-fast database schema check for `npm run dev` (wired via the `predev` script).
 *
 * Why this exists
 * ---------------
 * When code is pulled that requires a newer schema (e.g. the attendance
 * change-request rework) but the local database was never migrated, the server
 * still boots and API calls explode at query time with:
 *
 *   PrismaClientKnownRequestError: The column `X.y` does not exist in the
 *   current database.
 *
 * That error surfaces far from its cause. This check runs `prisma migrate status`
 * before Next.js boots so an out-of-date schema fails LOUDLY at startup with the
 * exact remediation command, instead of as confusing 500s per request.
 *
 * Behavior
 * --------
 *   - schema up to date        -> quiet success, `npm run dev` proceeds
 *   - pending / failed / unknown migrations
 *                              -> loud error, exit 1 (`npm run dev` refuses to start)
 *   - database unreachable     -> loud WARNING, exit 0 (do not block hosts where the
 *                                 DB only becomes reachable later, e.g. tunnels)
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function line(char = "!", width = 76) {
  return char.repeat(width);
}

function banner(title, bodyLines) {
  console.error(`\n${line()}`);
  console.error(`!!  ${title}`);
  console.error(line());
  for (const bodyLine of bodyLines) console.error(`    ${bodyLine}`);
  console.error(`${line()}\n`);
}

let cli;
try {
  cli = require.resolve("prisma/build/index.js");
} catch {
  // Production-style install without devDependencies: nothing to check with.
  process.exit(0);
}

const result = spawnSync(process.execPath, [cli, "migrate", "status"], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

// Engine binaries failing to download (offline host, blocked CDN) means the
// schema state is UNKNOWN, not out of sync — warn instead of blocking.
const engineUnavailable = /binaries\.prisma\.sh|prisma\.sh\/all_commits|failed, reason:|Checksum verification failed/i.test(
  output,
);
if (engineUnavailable) {
  banner("WARNING: `prisma migrate status` could not fetch its schema engine", [
    output.trim().split("\n").slice(-2).join("\n    "),
    "The migration check is skipped. If API calls fail with",
    "`The column `X` does not exist in the current database`, run",
    "`npx prisma migrate dev` once you are back online.",
  ]);
  process.exit(0);
}

// Trust the exit code, but also parse the output: pending/failed migrations are
// reported there, and older CLI versions did not always use a non-zero status.
const schemaOutOfSync = /have not yet been applied|following migration|migration.*\bfailed\b|does not match the migration history|drift/i.test(
  output,
);

if (result.status === 0 && !schemaOutOfSync) {
  // "Database schema is up to date!" — stay quiet.
  process.exit(0);
}

if (result.error) {
  banner("WARNING: could not run `prisma migrate status`", [
    `spawn error: ${result.error.message}`,
    "The dev server will start anyway, but database-backed pages may fail.",
    "Run `npx prisma migrate status` manually to diagnose.",
  ]);
  process.exit(0);
}

const unreachable =
  /Can't reach database server|connect ECONNREFUSED|Connection refused|timed out|getaddrinfo|ECONNRESET|authentication failed|password authentication failed/i.test(
    output,
  );

if (unreachable && !schemaOutOfSync) {
  banner("WARNING: the database is unreachable, so the migration check was skipped", [
    output.trim().split("\n").slice(-3).join("\n    "),
    "",
    "The dev server will start anyway, but every database-backed page will fail",
    "until PostgreSQL is running (local dev: `docker compose up -d db`).",
  ]);
  process.exit(0);
}

// Any other non-zero status means Prisma had real schema news to report:
// pending migrations, a failed migration, or drift. Fail loudly.
banner("DATABASE SCHEMA IS OUT OF SYNC — dev server not started", [
  output.trim(),
  "",
  "Apply the pending migrations before starting the dev server:",
  "  local development:      npx prisma migrate dev",
  "  staging / production:   npx prisma migrate deploy",
  "",
  "Then re-run `npm run dev`.",
]);
process.exit(1);
