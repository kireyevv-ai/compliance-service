import { NextResponse, type NextRequest } from "next/server";
import { BETA_ACCESS_COOKIE, isBetaAccessEnabled, verifyBetaAccessToken } from "@/beta-access";

const PUBLIC_PATHS = ["/beta", "/api/beta-access", "/api/health"];

export async function middleware(request: NextRequest) {
  if (!isBetaAccessEnabled()) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (isPublicPath || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const token = request.cookies.get(BETA_ACCESS_COOKIE)?.value;

  if (await verifyBetaAccessToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Требуется beta-доступ" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/beta", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
