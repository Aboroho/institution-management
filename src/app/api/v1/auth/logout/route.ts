export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth/token";
export async function POST() {
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(sessionCookieName(), "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
