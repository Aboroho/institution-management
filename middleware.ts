import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, sessionCookieName } from "@/lib/auth/token";

async function roleFromRequest(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(sessionCookieName())?.value;
  if (!token) return null;
  const session = await verifySession(token);
  return session?.role ?? null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname === "/login";
  const isProtected =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/teacher") ||
    pathname.startsWith("/student");

  if (!isAuthPage && !isProtected) return NextResponse.next();

  const role = await roleFromRequest(req);

  if (isAuthPage) {
    if (role === "ADMIN") return NextResponse.redirect(new URL("/admin/dashboard", req.url));
    if (role === "TEACHER") return NextResponse.redirect(new URL("/teacher/dashboard", req.url));
    if (role === "STUDENT") return NextResponse.redirect(new URL("/student/dashboard", req.url));
    return NextResponse.next();
  }

  if (!role) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin") && role !== "ADMIN") return NextResponse.redirect(new URL("/login", req.url));
  if (pathname.startsWith("/teacher") && role !== "TEACHER" && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname.startsWith("/student") && role !== "STUDENT") return NextResponse.redirect(new URL("/login", req.url));

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/admin/:path*", "/teacher/:path*", "/student/:path*"],
};
