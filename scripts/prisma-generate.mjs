#!/usr/bin/env node
/**
 * Generates Prisma Client from prisma/schema.prisma and verifies that the generated
 * client is able to talk to PostgreSQL directly (real query engine, no Accelerate).
 *
 * Why the verification exists
 * ---------------------------
 * `prisma generate --no-engine` (or PRISMA_GENERATE_NO_ENGINE=1 / PRISMA_GENERATE_DATAPROXY=1)
 * writes `"copyEngine": false` into the generated client config. In Prisma 5 the runtime
 * derives its engine choice from that flag:
 *
 *   // @prisma/client/runtime/library.js
 *   const useDataProxy = isPrismaUrl || !copyEngine
 *   if (useDataProxy) return new DataProxyEngine(config)
 *
 * A data-proxy client only accepts an Accelerate URL, so every query against a plain
 * `postgresql://` DATABASE_URL fails at runtime with:
 *
 *   Error validating datasource `db`: the URL must start with the protocol `prisma://`
 *
 * That failure happens on the first query in production and not during the build, which is
 * why it is easy to ship. This script turns it into a build-time error instead.
 *
 * Usage
 * -----
 *   node scripts/prisma-generate.mjs                # strict: generate + verify (build path)
 *   node scripts/prisma-generate.mjs --postinstall  # tolerant: never fails `npm install`
 *                                                   # (the CLI is a devDependency and may be
 *                                                   #  absent when installing with --omit=dev)
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tolerant = process.argv.includes("--postinstall");

function info(message) {
  console.log(`[prisma:generate] ${message}`);
}

function fail(message) {
  // `--postinstall` is best effort: installing dependencies must not be blocked by a
  // missing/unusable Prisma Client — `npm run build` regenerates it and fails loudly.
  if (tolerant) {
    console.warn(`\n[prisma:generate] WARNING: ${message}\n`);
    process.exit(0);
  }
  console.error(`\n[prisma:generate] ERROR: ${message}\n`);
  process.exit(1);
}

/** Non-sensitive one-line description of the runtime datasource configuration. */
function describeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "DATABASE_URL: not set in this environment";
  try {
    return `DATABASE_URL: present (scheme ${new URL(raw).protocol})`;
  } catch {
    return "DATABASE_URL: present but not parseable as a URL";
  }
}

function prismaCliPath() {
  try {
    return require.resolve("prisma/build/index.js");
  } catch {
    return null;
  }
}

function clientDir() {
  const candidates = [
    path.join(projectRoot, "node_modules", ".prisma", "client"),
    path.join(projectRoot, "node_modules", "@prisma", "client", ".prisma", "client"),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.js"))) ?? candidates[0];
}

/** Reads the `const config = { ... }` block that `prisma generate` writes into index.js. */
function readGeneratedConfig(indexFile) {
  const source = fs.readFileSync(indexFile, "utf8");
  const marker = "const config = ";
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = source.indexOf("{", markerIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  return null;
}

const ENGINE_BINARY = /^(libquery_engine|query_engine|query-engine)/;
const NOT_ENGINE_BINARY = /_bg\.|\.d\.ts$/;

function findEngineBinary(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .find((file) => ENGINE_BINARY.test(file) && !NOT_ENGINE_BINARY.test(file)) ?? null;
}

function verify() {
  const dir = clientDir();
  const indexFile = path.join(dir, "index.js");
  if (!fs.existsSync(indexFile)) {
    fail(`no generated Prisma Client found at ${path.relative(projectRoot, indexFile)}.`);
  }

  const config = readGeneratedConfig(indexFile);
  if (!config) {
    fail(
      `could not read the generated client config from ${path.relative(projectRoot, indexFile)}. ` +
        "Delete node_modules/.prisma/client and run `npm run prisma:generate` again.",
    );
  }

  const engineType = config.generator?.config?.engineType ?? "library";
  const copyEngine = config.copyEngine !== false;

  if (!copyEngine) {
    fail(
      "the generated Prisma Client was built without the query engine (copyEngine: false).\n" +
        "  In Prisma 5 that makes the client use the Prisma Accelerate / data-proxy engine, which\n" +
        "  only accepts a `prisma://` URL, so every query against PostgreSQL fails with:\n" +
        '    Error validating datasource `db`: the URL must start with the protocol `prisma://`\n\n' +
        "  Fix: run `prisma generate` WITHOUT `--no-engine` (and make sure PRISMA_GENERATE_NO_ENGINE,\n" +
        "  PRISMA_GENERATE_DATAPROXY and PRISMA_GENERATE_ACCELERATE are not set).",
    );
  }

  if (engineType === "client") {
    fail(
      'the generated Prisma Client uses engineType "client" (Accelerate/data-proxy only).\n' +
        "  This project talks to PostgreSQL directly; remove `engineType = \"client\"` from the\n" +
        "  generator block in prisma/schema.prisma and regenerate.",
    );
  }

  const engineFile = findEngineBinary(dir);
  const fallbackEngineFile = findEngineBinary(
    path.join(projectRoot, "node_modules", "@prisma", "engines"),
  );
  if (!engineFile && !fallbackEngineFile) {
    fail(
      "the generated client claims to bundle a query engine (copyEngine: true) but no engine\n" +
        "  binary exists in node_modules/.prisma/client or node_modules/@prisma/engines.\n" +
        "  The build host must be able to download it from https://binaries.prisma.sh during\n" +
        "  `prisma generate` (or provide one via PRISMA_QUERY_ENGINE_LIBRARY /\n" +
        "  PRISMA_ENGINES_MIRROR). Run `npx prisma generate` with network access and retry.",
    );
  }

  info(
    `verified: engineType=${engineType} copyEngine=${copyEngine} ` +
      `engine=${engineFile ?? `${fallbackEngineFile} (resolved from @prisma/engines)`}`,
  );
  info(describeDatabaseUrl());
}

const cli = prismaCliPath();
if (!cli) {
  if (tolerant) {
    info("Prisma CLI is not installed (production-only install) — skipping client generation.");
    process.exit(0);
  }
  fail("Prisma CLI not found. Install devDependencies (`npm install`) and retry.");
}

const generated = spawnSync(process.execPath, [cli, "generate"], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (generated.status !== 0) {
  fail(
    "`prisma generate` failed (see the CLI output above). " +
      "`npm run build` retries it and will not produce a build without a valid client.",
  );
}

verify();
