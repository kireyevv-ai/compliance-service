export interface Fact {
  id: string;
  scanId: string;
  pageUrl?: string;
  factType: string;
  value: Record<string, unknown>;
  createdAt: Date;
}
