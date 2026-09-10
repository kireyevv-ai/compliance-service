import { NextResponse } from "next/server";
import { getScanResult, userSafeScanError } from "../helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await context.params;
  const result = await getScanResult(scanId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    scan: {
      id: result.scan.id,
      status: result.scan.status,
      statusReason: userSafeScanError(result.scan.statusReason),
      siteType: result.scan.siteType,
      createdAt: result.scan.createdAt,
      finishedAt: result.scan.finishedAt
    },
    site: result.site,
    findings: result.findings,
    evidenceByFindingId: result.evidenceByFindingId,
    externalServices: result.externalServices,
    ruleEvaluationSummary: result.ruleEvaluationSummary,
    noEvaluationResults: result.noEvaluationResults
  });
}
