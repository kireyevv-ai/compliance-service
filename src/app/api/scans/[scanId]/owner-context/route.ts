import { NextResponse } from "next/server";
import { getOwnerContextForScan, saveOwnerAnswerForScan } from "@/app/api/owner-context/helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await context.params;
  const result = await getOwnerContextForScan(scanId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.ownerContext);
}

export async function POST(request: Request, context: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await context.params;
  const body = await request.json().catch(() => null);
  const result = await saveOwnerAnswerForScan(scanId, body);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.ownerContext);
}
