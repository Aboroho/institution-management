-- Attendance corrections belong to one AttendanceSession operation.
-- The original request table stored one recordId/oldStatus/newStatus per row.
-- Preserve those values by copying them into normalized child items before
-- removing the obsolete single-record columns.

CREATE TYPE "AttendanceChangeType" AS ENUM ('INITIAL_ENTRY', 'DIRECT_CORRECTION', 'APPROVED_REQUEST');

ALTER TABLE "AttendanceChangeLog"
  ADD COLUMN "changeType" "AttendanceChangeType" NOT NULL DEFAULT 'INITIAL_ENTRY',
  ADD COLUMN "operationId" TEXT,
  ADD COLUMN "requestId" TEXT;

-- Existing logs with an old status represent corrections; rows without one
-- are initial entries. This is a conservative classification for historical
-- audit rows; all new writes set the type explicitly.
UPDATE "AttendanceChangeLog"
SET "changeType" = CASE WHEN "oldStatus" IS NULL THEN 'INITIAL_ENTRY'::"AttendanceChangeType" ELSE 'DIRECT_CORRECTION'::"AttendanceChangeType" END;

ALTER TABLE "AttendanceChangeRequest"
  ADD COLUMN "sessionId" TEXT;

UPDATE "AttendanceChangeRequest" cr
SET "sessionId" = r."sessionId"
FROM "AttendanceRecord" r
WHERE r."id" = cr."recordId";

CREATE TABLE "AttendanceChangeRequestItem" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "oldStatus" "AttendanceStatus" NOT NULL,
    "newStatus" "AttendanceStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceChangeRequestItem_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AttendanceChangeRequestItem" ("id", "changeRequestId", "recordId", "oldStatus", "newStatus")
SELECT 'legacy_' || cr."id", cr."id", cr."recordId", cr."oldStatus", cr."newStatus"
FROM "AttendanceChangeRequest" cr;

-- Every historical request pointed to a record, and every record points to a
-- session. Fail migration rather than silently losing an audit association.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AttendanceChangeRequest" WHERE "sessionId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate AttendanceChangeRequest rows without a session';
  END IF;
END $$;

ALTER TABLE "AttendanceChangeRequest"
  ALTER COLUMN "sessionId" SET NOT NULL;

ALTER TABLE "AttendanceChangeRequestItem"
  ADD CONSTRAINT "AttendanceChangeRequestItem_changeRequestId_fkey"
    FOREIGN KEY ("changeRequestId") REFERENCES "AttendanceChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AttendanceChangeRequestItem_recordId_fkey"
    FOREIGN KEY ("recordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceChangeRequest"
  ADD CONSTRAINT "AttendanceChangeRequest_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceChangeLog"
  ADD CONSTRAINT "AttendanceChangeLog_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "AttendanceChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The old schema permitted multiple pending rows. Keep every historical row,
-- but close duplicate pending rows before enforcing one pending operation per
-- attendance entry.
WITH duplicates AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "createdAt", "id") AS rn
  FROM "AttendanceChangeRequest"
  WHERE "status" = 'PENDING'
)
UPDATE "AttendanceChangeRequest" cr
SET "status" = 'REJECTED',
    "reviewNote" = COALESCE(cr."reviewNote", 'Superseded by a newer pending attendance-entry request during migration'),
    "reviewedAt" = COALESCE(cr."reviewedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
FROM duplicates d
WHERE cr."id" = d."id" AND d.rn > 1;

DROP INDEX IF EXISTS "AttendanceChangeRequest_recordId_idx";
ALTER TABLE "AttendanceChangeRequest"
  DROP CONSTRAINT "AttendanceChangeRequest_recordId_fkey",
  DROP COLUMN "recordId",
  DROP COLUMN "oldStatus",
  DROP COLUMN "newStatus";

CREATE INDEX "AttendanceChangeRequest_sessionId_idx" ON "AttendanceChangeRequest"("sessionId");
CREATE UNIQUE INDEX "AttendanceChangeRequest_one_pending_per_session_key"
  ON "AttendanceChangeRequest"("sessionId")
  WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "AttendanceChangeRequestItem_changeRequestId_recordId_key"
  ON "AttendanceChangeRequestItem"("changeRequestId", "recordId");
CREATE INDEX "AttendanceChangeRequestItem_recordId_idx" ON "AttendanceChangeRequestItem"("recordId");
CREATE INDEX "AttendanceChangeLog_requestId_idx" ON "AttendanceChangeLog"("requestId");
CREATE INDEX "AttendanceChangeLog_operationId_idx" ON "AttendanceChangeLog"("operationId");
