-- Roll numbers are required values entered by an administrator (unique per section), not
-- database-generated placeholders. Existing rows already hold a backfilled value, so the
-- generating sequence and its column default can be removed. The composite unique index
-- "StudentEnrollment_sectionId_rollNumber_key" stays in place and remains the guarantee.
ALTER TABLE "StudentEnrollment" ALTER COLUMN "rollNumber" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "StudentEnrollment_rollNumber_seq";
