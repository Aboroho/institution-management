export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { forbidden, validationError } from "@/lib/errors/errors";
import { audit } from "@/lib/audit/audit";
import {
  deleteNotice,
  getNoticeForViewer,
  updateNotice,
  type NoticeFileUpload,
} from "@/modules/notices/notices.service";
import { updateNoticePayloadSchema, type UpdateNoticePayload } from "@/modules/notices/notices.validation";

async function parseUpdateRequest(req: NextRequest): Promise<{ payload: UpdateNoticePayload; files: NoticeFileUpload[] }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    let body: unknown;
    try {
      body = await req.json() as unknown;
    } catch {
      throw validationError("Request body must be valid JSON");
    }
    return { payload: updateNoticePayloadSchema.parse(body), files: [] };
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw validationError("Notice multipart upload is invalid or too large");
  }
  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") throw validationError("Notice payload is required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload) as unknown;
  } catch {
    throw validationError("Notice payload is invalid JSON");
  }
  const payload = updateNoticePayloadSchema.parse(parsed);
  const values = form.getAll("files");
  if (values.some((value) => typeof value === "string")) throw validationError("Invalid attachment upload");
  const files: NoticeFileUpload[] = [];
  for (const value of values) {
    if (typeof File === "undefined" || !(value instanceof File)) continue;
    try {
      files.push({
        name: value.name,
        type: value.type,
        size: value.size,
        buffer: Buffer.from(await value.arrayBuffer()),
      });
    } catch {
      throw validationError("Invalid attachment upload");
    }
  }
  return { payload, files };
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    return ok(await getNoticeForViewer(auth, params.id));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN" && auth.role !== "TEACHER") return fail(forbidden("Only staff can edit notices"));
    const { payload, files } = await parseUpdateRequest(req);
    const updated = await updateNotice({
      auth,
      id: params.id,
      input: payload,
      files,
    });
    await audit({
      actorUserId: auth.userId,
      action: "notice.update",
      entityType: "Notice",
      entityId: params.id,
      newValues: {
        titleChanged: payload.title !== undefined,
        contentChanged: payload.content !== undefined,
        recipientsChanged: payload.targets !== undefined,
        addedAttachmentCount: files.length,
        removedAttachmentCount: payload.removeAttachmentIds?.length ?? 0,
      },
      ...requestMeta(),
    });
    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN" && auth.role !== "TEACHER") return fail(forbidden("Only staff can delete notices"));
    const rawVersion = req.nextUrl.searchParams.get("version");
    const expectedVersion = rawVersion ? Number(rawVersion) : NaN;
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) throw validationError("Notice version is required");
    const deleted = await deleteNotice({ auth, id: params.id, expectedVersion });
    await audit({ actorUserId: auth.userId, action: "notice.delete", entityType: "Notice", entityId: params.id, ...requestMeta() });
    return ok(deleted);
  } catch (error) {
    return fail(error);
  }
}
