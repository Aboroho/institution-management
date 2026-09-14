-- The Attendance Report counts per-session modifications by following the existing
-- AttendanceChangeLog -> AttendanceRecord relation (recordId -> sessionId), which is
-- always populated. The denormalized "attendanceSessionId" column added by
-- 20260915000000_attendance_report_indexes was nullable and never backfilled, so change
-- logs written before it existed counted as zero modifications, and reading it required
-- every environment to apply the migration *and* regenerate the Prisma Client before the
-- report endpoint could run. Drop it so the relation stays the single source of truth.
--
-- IF EXISTS keeps this safe on databases that never applied the additive migration.

DROP INDEX IF EXISTS "AttendanceChangeLog_attendanceSessionId_idx";

ALTER TABLE "AttendanceChangeLog"
  DROP COLUMN IF EXISTS "attendanceSessionId";
