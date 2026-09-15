-- Attendance sessions count their own edits.
--
-- "Updated N times" means the number of edit operations (saves / approved
-- change requests) that changed at least one student record AFTER the session
-- was created. Counting change-log rows instead inflated the number: one edit
-- touching 30 students rendered as "Updated: 30 times".
--
-- Going forward the application increments AttendanceSession."updateCount" once
-- per mutating save/approval, no matter how many records the operation touches.
-- This migration adds the counter and backfills it from existing history.
--
-- Backfill rationale: every bulk save runs in a single transaction and
-- AttendanceChangeLog."createdAt" defaults to CURRENT_TIMESTAMP, which Postgres
-- evaluates once per transaction. So all logs written by one save share the
-- same ("createdAt", "changedById"), and the number of distinct pairs per
-- session minus the initial-creation batch approximates the number of edits.
-- Sessions without any logs keep the default 0.

ALTER TABLE "AttendanceSession"
  ADD COLUMN "updateCount" INTEGER NOT NULL DEFAULT 0;

WITH batches AS (
  SELECT r."sessionId" AS "sid", COUNT(DISTINCT (l."createdAt", l."changedById")) AS "n"
  FROM "AttendanceChangeLog" l
  JOIN "AttendanceRecord" r ON r."id" = l."recordId"
  GROUP BY r."sessionId"
)
UPDATE "AttendanceSession" s
SET "updateCount" = GREATEST((b."n" - 1)::integer, 0)
FROM batches b
WHERE b."sid" = s."id";
