import { describe, expect, it } from "vitest";
import { createNoticePayloadSchema, updateNoticePayloadSchema } from "@/modules/notices/notices.validation";

describe("notice write validation", () => {
  it("requires a title, message and at least one target", () => {
    expect(() => createNoticePayloadSchema.parse({ title: "", content: "", targets: [] })).toThrow();
    expect(createNoticePayloadSchema.parse({
      title: "Exam update",
      content: "The timetable is available.",
      expiresAt: null,
      targets: [{ type: "COURSE_OFFERING", ids: ["offering-1"] }],
    }).targets[0].type).toBe("COURSE_OFFERING");
  });

  it("allows attachment-only edits while validating recipient changes when supplied", () => {
    expect(updateNoticePayloadSchema.parse({ expectedVersion: 1, removeAttachmentIds: ["attachment-1"] }).removeAttachmentIds).toEqual(["attachment-1"]);
    expect(() => updateNoticePayloadSchema.parse({ targets: [{ type: "STUDENT", ids: [] }] })).toThrow();
  });
});
