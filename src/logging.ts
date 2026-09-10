type LogLevel = "info" | "warn" | "error";

type LogFields = {
  scanId?: string;
  status?: string;
  domain?: string;
  durationMs?: number;
  pagesCrawled?: number;
  browserPagesAttempted?: number;
  browserPagesCompleted?: number;
  errorCategory?: string;
};

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  console[level](
    JSON.stringify({
      level,
      event,
      time: new Date().toISOString(),
      ...fields
    })
  );
}

export const logger = {
  info(event: string, fields?: LogFields) {
    write("info", event, fields);
  },
  warn(event: string, fields?: LogFields) {
    write("warn", event, fields);
  },
  error(event: string, fields?: LogFields) {
    write("error", event, fields);
  }
};
