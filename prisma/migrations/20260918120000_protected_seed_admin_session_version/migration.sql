-- Protected seed admin + session epoch.
--
-- Why a schema change is required
-- -------------------------------
-- The protected seed admin (SEED_ADMIN_EMAIL in .env) must be recognizable by the
-- backend long after `prisma/seed.ts` ran. An environment variable cannot do that:
-- it is not persisted with the row, it can be changed or lost between deployments,
-- and it cannot be enforced in SQL. A persisted, server-controlled column can.
--
-- `isProtectedSeedAdmin` is written ONLY by prisma/seed.ts. No API route accepts it
-- as input, so client-supplied values can never grant or remove the protection.
--
-- `sessionVersion` is the session epoch used to invalidate already-issued JWTs on
-- password change / account removal without introducing a session table.

ALTER TABLE "User"
  ADD COLUMN "isProtectedSeedAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- At most one protected seed admin may exist, enforced by the database itself so a
-- bug or a race in account management cannot produce a second protected account.
-- (Partial unique index: Prisma's schema DSL cannot express the WHERE clause, so it
-- is created here and replayed identically into the shadow database by `migrate dev`.)
CREATE UNIQUE INDEX "User_single_protected_seed_admin_key"
  ON "User" ("isProtectedSeedAdmin")
  WHERE "isProtectedSeedAdmin" = true;

-- Existing installations keep their current admin account untouched: no row is
-- marked as protected here. Run `npm run db:seed` once after deploying this
-- migration; the seed script is idempotent and promotes exactly the account
-- configured by SEED_ADMIN_EMAIL to protected seed admin. Until then admin
-- management endpoints fail closed (no account is recognized as the seed admin).
