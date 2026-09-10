export interface BrowserAuditConfig {
  maxBrowserPages: number;
  navigationTimeoutMs: number;
  totalBrowserAuditTimeoutMs: number;
  maxNetworkObservationsPerPage: number;
  maxUniqueHostsPerPage: number;
  settleDelayMs: number;
}

export const DEFAULT_BROWSER_AUDIT_CONFIG: BrowserAuditConfig = {
  maxBrowserPages: 10,
  navigationTimeoutMs: 7_000,
  totalBrowserAuditTimeoutMs: 45_000,
  maxNetworkObservationsPerPage: 80,
  maxUniqueHostsPerPage: 30,
  settleDelayMs: 500
};
