export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { getNoticeAttachmentDownloadUrl } from "@/modules/notices/notices.service";

export async function GET(_: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  try {
    const auth = await requireAuth();
    return ok(await getNoticeAttachmentDownloadUrl(auth, params.id, params.attachmentId));
  } catch (error) {
    return fail(error);
  }
}
