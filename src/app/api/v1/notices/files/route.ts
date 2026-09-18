export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { getNoticeFileForDownload } from "@/modules/notices/notices.service";
import { fail } from "@/lib/api/response";

function contentDisposition(fileName: string): string {
  const safe = fileName.replace(/[\"\\\r\n]/g, "_");
  return `attachment; filename="${safe}"`;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth();
    if (!auth) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication required", details: null } }, { status: 401 });
    }
    const key = req.nextUrl.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "key is required", details: null } }, { status: 422 });
    }
    const result = await getNoticeFileForDownload(auth, key);
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": contentDisposition(result.fileName),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = fail(error);
    return response;
  }
}
