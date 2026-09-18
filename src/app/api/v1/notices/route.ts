export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { fail, ok, paginated, parsePagination } from "@/lib/api/response";
import { forbidden, validationError } from "@/lib/errors/errors";
import { audit } from "@/lib/audit/audit";
import {
  createNotice,
  listEligibleNoticeRecipients,
  listNoticesForViewer,
  type NoticeFileUpload,
} from "@/modules/notices/notices.service";
import { createNoticePayloadSchema } from "@/modules/notices/notices.validation";
import type { CreateNoticePayload } from "@/modules/notices/notices.validation";

async function parseCreateRequest(req: NextRequest): Promise<{ payload: CreateNoticePayload; files: NoticeFileUpload[] }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    let body: unknown;
    try {
      body = await req.json() as unknown;
    } catch {
      throw validationError("Request body must be valid JSON");
    }
    const payload = createNoticePayloadSchema.parse(body);
    return { payload, files: [] };
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
  const payload = createNoticePayloadSchema.parse(parsed);
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

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const search = req.nextUrl.searchParams;
    if (search.get("recipients") === "true") {
      if (auth.role !== "ADMIN" && auth.role !== "TEACHER") return fail(forbidden("Only staff can select notice recipients"));
      return ok(await listEligibleNoticeRecipients(auth));
    }
    const { page, limit } = parsePagination(search);
    const result = await listNoticesForViewer({
      auth,
      courseOfferingId: search.get("courseOfferingId") || undefined,
      search: search.get("search")?.trim() || undefined,
      page,
      limit,
    });
    return paginated(result.items, page, limit, result.total);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.role !== "ADMIN" && auth.role !== "TEACHER") return fail(forbidden("Only admins and teachers can create notices"));
    const { payload, files } = await parseCreateRequest(req);
    const created = await createNotice({
      auth,
      input: {
        title: payload.title,
        content: payload.content,
        expiresAt: payload.expiresAt ?? null,
        targets: payload.targets,
      },
      files,
    });
    await audit({
      actorUserId: auth.userId,
      action: "notice.create",
      entityType: "Notice",
      entityId: created.id,
      newValues: { title: payload.title, targetTypes: payload.targets.map((target) => target.type), attachmentCount: files.length },
      ...requestMeta(),
    });
    return ok(created, undefined, 201);
  } catch (error) {
    return fail(error);
  }
}
