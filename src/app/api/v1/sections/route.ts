export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requestMeta } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/permissions/permissions";
import { ok, fail, paginated, parsePagination } from "@/lib/api/response";
import { listSections, createSection } from "@/modules/academic/academic.service";
import { audit } from "@/lib/audit/audit";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const s = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(s);
    const { items, total } = await listSections({
      academicYearId: s.get("academicYearId") || undefined, tradeId: s.get("tradeId") || undefined,
      semesterId: s.get("semesterId") || undefined, shiftId: s.get("shiftId") || undefined,
      search: s.get("search") || undefined, page, limit,
    });
    return paginated(items, page, limit, total);
  } catch (e) { return fail(e); }
}

const schema = z.object({
  academicYearId: z.string().min(1), tradeId: z.string().min(1), semesterId: z.string().min(1),
  shiftId: z.string().min(1), name: z.string().min(1), capacity: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    requireAdmin(auth);
    const body = schema.parse(await req.json());
    const created = await createSection(body);
    await audit({ actorUserId: auth.userId, action: "section.create", entityType: "Section", entityId: created.id, newValues: created, ...requestMeta() });
    return ok(created, undefined, 201);
  } catch (e) { return fail(e); }
}
