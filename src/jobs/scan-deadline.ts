export const SCAN_TOTAL_TIMEOUT_REASON = "SCAN_TOTAL_TIMEOUT";

export class ScanDeadlineExceededError extends Error {
  constructor(message = "Scan total timeout") {
    super(message);
    this.name = "ScanDeadlineExceededError";
  }
}

export interface ScanDeadline {
  signal: AbortSignal;
  remainingMs(): number;
  throwIfExpired(): void;
  dispose(): void;
}

export function scanTotalTimeoutMs(): number {
  const raw = Number(process.env.SCAN_TOTAL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 90_000;
}

export function createScanDeadline(timeoutMs = scanTotalTimeoutMs()): ScanDeadline {
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => {
    controller.abort(new ScanDeadlineExceededError());
  }, timeoutMs);

  return {
    signal: controller.signal,
    remainingMs() {
      return Math.max(0, expiresAt - Date.now());
    },
    throwIfExpired() {
      if (controller.signal.aborted || Date.now() >= expiresAt) {
        if (!controller.signal.aborted) {
          controller.abort(new ScanDeadlineExceededError());
        }
        throw new ScanDeadlineExceededError();
      }
    },
    dispose() {
      clearTimeout(timer);
    }
  };
}

export function isScanDeadlineExceeded(error: unknown): boolean {
  return (
    error instanceof ScanDeadlineExceededError ||
    error instanceof Error && (error.name === "AbortError" || /scan total timeout|scan deadline|operation aborted/i.test(error.message))
  );
}

export function abortError(signal?: AbortSignal): Error | undefined {
  if (!signal?.aborted) {
    return undefined;
  }
  const reason = signal.reason;
  return reason instanceof Error ? reason : new ScanDeadlineExceededError();
}
