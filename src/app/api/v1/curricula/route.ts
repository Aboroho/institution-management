export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { listCurricula, createCurriculum } from "@/modules/courses/courses.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const s = req.nextUrl.searchParams;
    return ok(await listCurricula({ tradeId: s.get("tradeId") || undefined, semesterId: s.get("semesterId") || undefined }));
  } catch (e) { return fail(e); }
}

const schema = z.object({ tradeId: z.string().min(1), semesterId: z.string().min(1), name: z.string().min(1), courseIds: z.array(z.string()).optional(), isActive: z.boolean().optional() });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createCurriculum(body);
    await audit({ actorUserId: auth.userId, action: "curriculum.create", entityType: "Curriculum", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
