-- Notice management: recipient targeting, private attachments, creator ownership,
-- stable notice notification links, and soft deletion.

CREATE TYPE "NoticeTargetType" AS ENUM ('EVERYONE', 'ADMINS', 'COURSE_OFFERING', 'TEACHER', 'STUDENT');

ALTER TABLE "Notice" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Notice" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Notice" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Notice" ALTER COLUMN "courseOfferingId" DROP NOT NULL;
ALTER TABLE "Notice" ALTER COLUMN "teacherId" DROP NOT NULL;

-- Existing notices were teacher-created. Preserve that creator identity before
-- making the new ownership column mandatory.
UPDATE "Notice" AS n
SET "createdById" = t."userId"
FROM "Teacher" AS t
WHERE t."id" = n."teacherId";

ALTER TABLE "Notice" ALTER COLUMN "createdById" SET NOT NULL;

CREATE TABLE "NoticeTarget" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "targetType" "NoticeTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoticeTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoticeRecipient" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoticeRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoticeAttachment" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoticeAttachment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification" ADD COLUMN "noticeId" TEXT;

-- Link notices created by the previous implementation to their existing
-- notifications so notification clicks remain stable after the migration.
UPDATE "Notification" AS n
SET "noticeId" = n."resourceId"
WHERE n."resourceType" = 'Notice'
  AND n."resourceId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Notice" AS notice WHERE notice."id" = n."resourceId");

-- Preserve visibility for historical notices. The old course-offering notice
-- semantics were section-scoped, so use the same trusted context relationship
-- used by the application for enrolled students.
INSERT INTO "NoticeTarget" ("id", "noticeId", "targetType", "targetId")
SELECT md5(n."id" || ':course-offering'), n."id", 'COURSE_OFFERING', n."courseOfferingId"
FROM "Notice" AS n
WHERE n."courseOfferingId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "NoticeTarget" AS target
    WHERE target."noticeId" = n."id"
      AND target."targetType" = 'COURSE_OFFERING'
      AND target."targetId" = n."courseOfferingId"
  );

INSERT INTO "NoticeRecipient" ("id", "noticeId", "userId")
SELECT DISTINCT md5(n."id" || ':' || u."id"), n."id", u."id"
FROM "Notice" AS n
JOIN "CourseOffering" AS offering ON offering."id" = n."courseOfferingId"
JOIN "StudentEnrollment" AS enrollment
  ON enrollment."academicYearId" = offering."academicYearId"
 AND enrollment."tradeId" = offering."tradeId"
 AND enrollment."semesterId" = offering."semesterId"
 AND enrollment."shiftId" = offering."shiftId"
 AND enrollment."sectionId" = offering."sectionId"
 AND enrollment."status" = 'ACTIVE'
JOIN "Student" AS student ON student."id" = enrollment."studentId"
JOIN "User" AS u ON u."id" = student."userId" AND u."isActive" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "NoticeRecipient" AS recipient
  WHERE recipient."noticeId" = n."id" AND recipient."userId" = u."id"
);

CREATE UNIQUE INDEX "NoticeTarget_noticeId_targetType_targetId_key"
  ON "NoticeTarget"("noticeId", "targetType", "targetId");
CREATE INDEX "NoticeTarget_targetType_targetId_idx"
  ON "NoticeTarget"("targetType", "targetId");
CREATE INDEX "NoticeTarget_noticeId_idx" ON "NoticeTarget"("noticeId");

CREATE UNIQUE INDEX "NoticeRecipient_noticeId_userId_key"
  ON "NoticeRecipient"("noticeId", "userId");
CREATE INDEX "NoticeRecipient_userId_idx" ON "NoticeRecipient"("userId");
CREATE INDEX "NoticeRecipient_noticeId_idx" ON "NoticeRecipient"("noticeId");

CREATE UNIQUE INDEX "NoticeAttachment_noticeId_fileId_key"
  ON "NoticeAttachment"("noticeId", "fileId");
CREATE INDEX "NoticeAttachment_noticeId_idx" ON "NoticeAttachment"("noticeId");
CREATE INDEX "NoticeAttachment_fileId_idx" ON "NoticeAttachment"("fileId");

CREATE INDEX "Notice_createdById_idx" ON "Notice"("createdById");
CREATE INDEX "Notice_deletedAt_idx" ON "Notice"("deletedAt");
CREATE INDEX "Notification_noticeId_idx" ON "Notification"("noticeId");

-- A previous retry or overlapping delivery may have produced duplicate legacy
-- notice notifications. Keep the oldest row (and its delivery/read state) before
-- adding the database-level deduplication constraint.
DELETE FROM "Notification" AS newer
USING "Notification" AS older
WHERE newer."noticeId" IS NOT NULL
  AND newer."noticeId" = older."noticeId"
  AND newer."recipientId" = older."recipientId"
  AND newer."id" <> older."id"
  AND (newer."createdAt" > older."createdAt"
       OR (newer."createdAt" = older."createdAt" AND newer."id" > older."id"));

CREATE UNIQUE INDEX "Notification_recipientId_noticeId_key"
  ON "Notification"("recipientId", "noticeId");

ALTER TABLE "NoticeTarget"
  ADD CONSTRAINT "NoticeTarget_noticeId_fkey"
  FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoticeRecipient"
  ADD CONSTRAINT "NoticeRecipient_noticeId_fkey"
  FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoticeRecipient"
  ADD CONSTRAINT "NoticeRecipient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NoticeAttachment"
  ADD CONSTRAINT "NoticeAttachment_noticeId_fkey"
  FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoticeAttachment"
  ADD CONSTRAINT "NoticeAttachment_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notice"
  ADD CONSTRAINT "Notice_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_noticeId_fkey"
  FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
