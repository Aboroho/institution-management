/**
 * Builds the JSON `payload` the notice composer sends to the notices API.
 *
 * The API validates create and update bodies with *strict* schemas
 * (src/modules/notices/notices.validation.ts), so every key the client sends
 * must belong to the schema for that request:
 *
 *   POST  /notices      -> { title, content, expiresAt, targets }
 *   PATCH /notices/{id} -> the same fields + `expectedVersion` (required)
 *                          and optionally `removeAttachmentIds`
 *
 * Keeping this in one pure function prevents update-only keys from leaking
 * into create requests (which used to fail with
 * "Unrecognized key(s) in object: 'removeAttachmentIds'").
 */

export type NoticeTargetKind = "EVERYONE" | "ADMINS" | "COURSE_OFFERING" | "TEACHER" | "STUDENT";

export interface NoticeTargetPayload {
  type: NoticeTargetKind;
  ids: string[];
}

export interface NoticeComposerDraft {
  title: string;
  content: string;
  /** Value of the `<input type="date">` (yyyy-mm-dd) or an empty string when unset. */
  expiresAt: string;
  targets: NoticeTargetPayload[];
}

export interface NoticeEditContext {
  /** Optimistic-concurrency version of the notice being edited. */
  version: number;
  /** Existing attachment ids the user chose to remove in this edit. */
  removeAttachmentIds: string[];
}

export interface CreateNoticeRequestPayload {
  title: string;
  content: string;
  expiresAt: string | null;
  targets: NoticeTargetPayload[];
}

export interface UpdateNoticeRequestPayload extends CreateNoticeRequestPayload {
  expectedVersion: number;
  removeAttachmentIds?: string[];
}

function basePayload(draft: NoticeComposerDraft): CreateNoticeRequestPayload {
  return {
    title: draft.title.trim(),
    content: draft.content.trim(),
    expiresAt: draft.expiresAt || null,
    targets: draft.targets,
  };
}

/** Payload for `POST /notices`. Never includes update-only keys. */
export function buildCreateNoticePayload(draft: NoticeComposerDraft): CreateNoticeRequestPayload {
  return basePayload(draft);
}

/** Payload for `PATCH /notices/{id}`. */
export function buildUpdateNoticePayload(draft: NoticeComposerDraft, edit: NoticeEditContext): UpdateNoticeRequestPayload {
  const payload: UpdateNoticeRequestPayload = {
    ...basePayload(draft),
    expectedVersion: edit.version,
  };
  const removeIds = Array.from(new Set(edit.removeAttachmentIds.filter((id) => id.length > 0)));
  if (removeIds.length > 0) payload.removeAttachmentIds = removeIds;
  return payload;
}

/**
 * Convenience wrapper used by the composer: `edit` is `null`/`undefined` when
 * publishing a new notice and set when editing an existing one.
 */
export function buildNoticePayload(
  draft: NoticeComposerDraft,
  edit?: NoticeEditContext | null,
): CreateNoticeRequestPayload | UpdateNoticeRequestPayload {
  return edit ? buildUpdateNoticePayload(draft, edit) : buildCreateNoticePayload(draft);
}
