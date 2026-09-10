export type EvidenceType =
  | "DOM_FRAGMENT"
  | "TEXT_FRAGMENT"
  | "NETWORK_EVENT"
  | "NETWORK_OBSERVATION"
  | "COOKIE_STORAGE_EVENT"
  | "BROWSER_STATE"
  | "DOCUMENT_REFERENCE"
  | "SCREENSHOT";

export interface Evidence {
  id: string;
  scanId: string;
  factId?: string;
  evidenceType: EvidenceType;
  pageUrl: string;
  payload?: Record<string, unknown>;
  storageRef?: string;
  createdAt: Date;
}
