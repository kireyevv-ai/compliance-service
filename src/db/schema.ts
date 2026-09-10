export const SITE_TYPES = ["B2B", "B2C_SERVICE", "ECOMMERCE", "OTHER"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SCAN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const FINDING_STATUSES = ["PASS", "FAIL", "WARNING", "MANUAL_CHECK"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

export interface Site {
  id: string;
  userId: string;
  url: string;
  normalizedDomain: string;
  createdAt: Date;
}

export interface Scan {
  id: string;
  siteId: string;
  status: ScanStatus;
  statusReason: string | null;
  siteType: SiteType;
  scannerVersion: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}
