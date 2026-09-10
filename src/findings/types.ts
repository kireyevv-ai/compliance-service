import type { FindingStatus, Severity } from "@/db/schema";

export interface Finding {
  id: string;
  scanId: string;
  ruleId: string;
  ruleVersion: string;
  status: FindingStatus;
  severity: Severity;
  confidence: number;
  summary: string;
  explanation: string;
  remediation: string;
  missingContext: string[];
  createdAt: Date;
}
