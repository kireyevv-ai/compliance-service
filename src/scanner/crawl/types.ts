export interface CrawlDocumentLink {
  url: string;
  contentType?: string;
}

export interface CrawledPage {
  url: string;
  status: number;
  contentType: string;
  title: string;
  html: string;
  contentLimited?: boolean;
  limitationReason?: string;
  responseBodyBytes?: number;
  responseBodyLimitBytes?: number;
  declaredContentLength?: number;
  internalLinks: string[];
  externalLinks: string[];
  documentLinks: CrawlDocumentLink[];
}

export interface CrawlResult {
  startUrl: string;
  normalizedDomain: string;
  pages: CrawledPage[];
  documentLinks: CrawlDocumentLink[];
  maxPagesReached?: boolean;
  pendingInternalUrls?: number;
}
