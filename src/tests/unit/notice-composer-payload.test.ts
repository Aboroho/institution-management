import { describe, expect, it } from "vitest";
import {
  buildCreateNoticePayload,
  buildNoticePayload,
  buildUpdateNoticePayload,
  type NoticeComposerDraft,
} from "@/lib/notices/composer-payload";
import { createNoticePayloadSchema, updateNoticePayloadSchema } from "@/modules/notices/notices.validation";

/**
 * Regression coverage for "Unrecognized key(s) in object: 'removeAttachmentIds'".
 *
 * The API validates notice bodies with strict Zod schemas, so the payload the
 * composer sends is round-tripped through the real schemas here: whatever the
 * UI builds for a create must pass `createNoticePayloadSchema`, and whatever it
 * builds for an edit must pass `updateNoticePayloadSchema`.
 */

const draft: NoticeComposerDraft = {
  title: "  Midterm examination schedule  ",
  content: "  The timetable is now available on the notice board.  ",
  expiresAt: "",
  targets: [{ type: "COURSE_OFFERING", ids: ["offering-1"] }],
};

/** Mirrors the multipart `payload` field: JSON.stringify drops `undefined` values. */
const overTheWire = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

describe("notice composer payloads", () => {
  it("creates a notice without update-only keys so the strict create schema accepts it", () => {
    const payload = overTheWire(buildCreateNoticePayload(draft));

    expect(Object.keys(payload).sort()).toEqual(["content", "expiresAt", "targets", "title"]);
    expect(payload).not.toHaveProperty("removeAttachmentIds");
    expect(payload).not.toHaveProperty("expectedVersion");
    expect(() => createNoticePayloadSchema.parse(payload)).not.toThrow();
  });

  it("does not leak removeAttachmentIds into a create even when the composer tracked removals", () => {
    // `buildNoticePayload` with no edit context is what the composer uses for "Publish notice".
    const payload = overTheWire(buildNoticePayload(draft, null));
    expect(payload).not.toHaveProperty("removeAttachmentIds");
    expect(createNoticePayloadSchema.parse(payload).title).toBe("Midterm examination schedule");
  });

  it("trims text, turns an empty expiry into null and keeps a chosen expiry date", () => {
    const withoutExpiry = buildCreateNoticePayload(draft);
    expect(withoutExpiry.title).toBe("Midterm examination schedule");
    expect(withoutExpiry.content).toBe("The timetable is now available on the notice board.");
    expect(withoutExpiry.expiresAt).toBeNull();

    const withExpiry = buildCreateNoticePayload({ ...draft, expiresAt: "2026-12-31" });
    expect(withExpiry.expiresAt).toBe("2026-12-31");
    expect(createNoticePayloadSchema.parse(overTheWire(withExpiry)).expiresAt).toBeInstanceOf(Date);
  });

  it("includes the optimistic version and removed attachment ids when editing", () => {
    const payload = overTheWire(buildUpdateNoticePayload(draft, {
      version: 3,
      removeAttachmentIds: ["attachment-1", "attachment-1", "", "attachment-2"],
    }));

    expect(payload.expectedVersion).toBe(3);
    expect(payload.removeAttachmentIds).toEqual(["attachment-1", "attachment-2"]);
    const parsed = updateNoticePayloadSchema.parse(payload);
    expect(parsed.expectedVersion).toBe(3);
    expect(parsed.removeAttachmentIds).toEqual(["attachment-1", "attachment-2"]);
  });

  it("omits removeAttachmentIds from an edit that removes nothing", () => {
    const payload = overTheWire(buildNoticePayload(draft, { version: 1, removeAttachmentIds: [] }));

    expect(payload.expectedVersion).toBe(1);
    expect(payload).not.toHaveProperty("removeAttachmentIds");
    expect(() => updateNoticePayloadSchema.parse(payload)).not.toThrow();
  });

  it("documents why the old behaviour failed: the create schema is strict", () => {
    expect(() => createNoticePayloadSchema.parse({
      ...overTheWire(buildCreateNoticePayload(draft)),
      removeAttachmentIds: [],
    })).toThrow(/Unrecognized key/);
  });
});
