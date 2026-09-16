-- Account management support for the User model:
-- * "isSeedAdmin" is the persistent, server-side marker of the protected system
--   account created by prisma/seed.ts from SEED_ADMIN_* env config. Application
--   APIs never write this column; the seed script backfills it for an existing
--   account whose email matches SEED_ADMIN_EMAIL so upgrading deployments keep
--   exactly one protected admin without creating a second account.
-- * "tokenVersion" is embedded in the session JWT and incremented whenever the
--   password changes, which revokes every older token (stateless-JWT session
--   invalidation without a server-side session store).
ALTER TABLE "User" ADD COLUMN "isSeedAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
