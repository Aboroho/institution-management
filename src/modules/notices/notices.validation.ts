import { z } from "zod";

export const noticeTargetSchema = z.object({
  type: z.enum(["EVERYONE", "ADMINS", "COURSE_OFFERING", "TEACHER", "STUDENT"]),
  ids: z.array(z.string().trim().min(1).max(100)).max(1000).default([]),
}).strict().superRefine((target, context) => {
  const isGroup = target.type === "EVERYONE" || target.type === "ADMINS";
  if (isGroup && target.ids.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "Group targets do not accept IDs", path: ["ids"] });
  if (!isGroup && target.ids.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "Select at least one target ID", path: ["ids"] });
});

const noticeFields = {
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be 200 characters or fewer"),
  content: z.string().trim().min(1, "Content is required").max(100000, "Content is too long"),
  expiresAt: z.coerce.date().nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
  removeAttachmentIds: z.array(z.string().min(1)).max(10).optional(),
};

export const createNoticePayloadSchema = z.object({
  title: noticeFields.title,
  content: noticeFields.content,
  expiresAt: noticeFields.expiresAt,
  targets: z.array(noticeTargetSchema).min(1).max(100),
}).strict();

export const updateNoticePayloadSchema = z.object({
  title: noticeFields.title.optional(),
  content: noticeFields.content.optional(),
  expiresAt: noticeFields.expiresAt,
  expectedVersion: z.number().int().positive(),
  removeAttachmentIds: noticeFields.removeAttachmentIds,
  targets: z.array(noticeTargetSchema).min(1).max(100).optional(),
}).strict();

export type CreateNoticePayload = z.infer<typeof createNoticePayloadSchema>;
export type UpdateNoticePayload = z.infer<typeof updateNoticePayloadSchema>;
