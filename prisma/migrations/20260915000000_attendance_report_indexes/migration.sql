-- Attendance Report: add a denormalized attendanceSessionId column on
-- AttendanceChangeLog so the per-session modification count uses an index
-- instead of joining through AttendanceRecord.
--
-- The column is nullable so the migration can run on existing databases
-- without backfilling historical rows. The attendance service writes the
-- column for every new log going forward. Historical rows remain queryable
-- via the existing relation index on recordId -> record.sessionId.

ALTER TABLE "AttendanceChangeLog"
  ADD COLUMN "attendanceSessionId" TEXT;

CREATE INDEX "AttendanceChangeLog_attendanceSessionId_idx"
  ON "AttendanceChangeLog"("attendanceSessionId");
