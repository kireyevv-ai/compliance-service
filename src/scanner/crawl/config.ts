export interface CrawlConfig {
  maxPages: number;
  requestTimeoutMs: number;
  totalTimeoutMs: number;
  maxResponseBodyBytes: number;
  maxRedirects: number;
  concurrency: number;
}

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPages: 30,
  requestTimeoutMs: 5_000,
  totalTimeoutMs: 30_000,
  maxResponseBodyBytes: 1_000_000,
  maxRedirects: 5,
  concurrency: 4
};
