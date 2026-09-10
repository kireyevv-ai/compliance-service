import { NextResponse } from "next/server";
import { getPool } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getPool().query("select 1");
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
