export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail } from "@/lib/api/response";
import { listSemesters, createSemester } from "@/modules/academic/academic.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const tradeId = req.nextUrl.searchParams.get("tradeId") || undefined;
    return ok(await listSemesters(tradeId));
  } catch (e) { return fail(e); }
}

const schema = z.object({ tradeId: z.string().min(1), number: z.number().int().min(1), name: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createSemester(body);
    await audit({ actorUserId: auth.userId, action: "semester.create", entityType: "Semester", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
