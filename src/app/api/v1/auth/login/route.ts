export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie, signSessionForUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit/audit";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid email or password", details: null } }, { status: 401 });
    }
    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid email or password", details: null } }, { status: 401 });
    }
    const token = await signSessionForUser(user);
    await audit({ actorUserId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
    const res = NextResponse.json({ data: { id: user.id, email: user.email, name: user.name, role: user.role } });
    setSessionCookie(res, token);
    return res;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: e.flatten() } }, { status: 422 });
    }
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong", details: null } }, { status: 500 });
  }
}
