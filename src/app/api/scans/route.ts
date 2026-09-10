import { NextResponse } from "next/server";
import { startScan } from "./helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const result = await startScan(payload);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      scanId: result.scanId,
      status: result.statusValue,
      siteDomain: result.siteDomain
    },
    { status: result.status }
  );
}
