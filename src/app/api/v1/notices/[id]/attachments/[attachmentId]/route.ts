export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { audit } from "@/lib/audit/audit";
import { validationError } from "@/lib/errors/errors";
import { removeNoticeAttachment } from "@/modules/notices/notices.service";

export async function DELETE(req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  try {
    const auth = await requireAuth();
    const rawVersion = req.nextUrl.searchParams.get("version");
    const expectedVersion = rawVersion ? Number(rawVersion) : NaN;
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) throw validationError("Notice version is required");
    const removed = await removeNoticeAttachment({ auth, noticeId: params.id, attachmentId: params.attachmentId, expectedVersion });
    await audit({ actorUserId: auth.userId, action: "notice.attachment.delete", entityType: "NoticeAttachment", entityId: params.attachmentId, newValues: { noticeId: params.id }, ...requestMeta() });
    return ok(removed);
  } catch (error) {
    return fail(error);
  }
}
