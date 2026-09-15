-- Add database-generated roll numbers to existing enrollments.
-- The sequence is global; the unique constraint scopes validity to each section.
CREATE SEQUENCE "StudentEnrollment_rollNumber_seq";

ALTER TABLE "StudentEnrollment" ADD COLUMN "rollNumber" INTEGER;
ALTER TABLE "StudentEnrollment"
  ALTER COLUMN "rollNumber" SET DEFAULT nextval('"StudentEnrollment_rollNumber_seq"'::regclass);

-- Backfill existing enrollments in creation order before making the new required field NOT NULL.
WITH ordered_enrollments AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id")::integer AS "nextRoll"
  FROM "StudentEnrollment"
)
UPDATE "StudentEnrollment" AS enrollment
SET "rollNumber" = ordered."nextRoll"
FROM ordered_enrollments AS ordered
WHERE enrollment."id" = ordered."id";

-- Continue after the backfilled values for all future enrollments.
SELECT setval(
  '"StudentEnrollment_rollNumber_seq"'::regclass,
  COALESCE(MAX("rollNumber"), 1),
  COUNT(*) > 0
)
FROM "StudentEnrollment";

ALTER TABLE "StudentEnrollment" ALTER COLUMN "rollNumber" SET NOT NULL;
ALTER SEQUENCE "StudentEnrollment_rollNumber_seq"
  OWNED BY "StudentEnrollment"."rollNumber";

CREATE UNIQUE INDEX "StudentEnrollment_sectionId_rollNumber_key"
  ON "StudentEnrollment"("sectionId", "rollNumber");
