export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ data: { status: "ok", time: new Date().toISOString() } });
}
