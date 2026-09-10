import { NextResponse } from "next/server";
import { BETA_ACCESS_COOKIE, betaAccessToken, verifyBetaAccessPassword } from "@/beta-access";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");

  if (!verifyBetaAccessPassword(password)) {
    if (request.headers.get("accept")?.includes("text/html")) {
      return NextResponse.redirect(new URL("/beta?error=1", request.url), { status: 303 });
    }

    return NextResponse.json({ error: "Неверный пароль beta-доступа" }, { status: 401 });
  }

  const token = await betaAccessToken();
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });

  if (token) {
    response.cookies.set(BETA_ACCESS_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
  }

  return response;
}
