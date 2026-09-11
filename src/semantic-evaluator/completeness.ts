import type { SemanticEvidenceCompleteness } from "./types";

export type SemanticEvidenceCompletenessMetadata = Record<string, unknown>;

export function classifySemanticEvidenceCompleteness(
  metadata: SemanticEvidenceCompletenessMetadata
): SemanticEvidenceCompleteness {
  const truncated = metadata.truncated === true;
  const originalTextLength = asNumber(metadata.originalTextLength);
  const maxChars = asNumber(metadata.maxChars);

  if (truncated || (originalTextLength !== undefined && maxChars !== undefined && originalTextLength > maxChars)) {
    return "TRUNCATED";
  }

  if (isKnownPartial(metadata)) {
    return "PARTIAL";
  }

  if (
    metadata.documentType === "HTML" &&
    isSuccessfulHttpStatus(metadata.fetchStatus) &&
    isSupportedHtmlContentType(metadata.fetchContentType) &&
    metadata.contentLimited === false &&
    metadata.interstitialDetected === false &&
    metadata.extractionSucceeded === true &&
    isSemanticRoot(metadata.extractionRoot) &&
    metadata.extractionRootFallback === false &&
    metadata.truncated === false &&
    originalTextLength !== undefined &&
    maxChars !== undefined &&
    originalTextLength <= maxChars
  ) {
    return "COMPLETE";
  }

  return "UNKNOWN";
}

function isKnownPartial(metadata: SemanticEvidenceCompletenessMetadata): boolean {
  return (
    metadata.contentLimited === true ||
    metadata.interstitialDetected === true ||
    metadata.limitationReason === "RESPONSE_BODY_TOO_LARGE" ||
    metadata.limitationReason === "CONTENT_LIMITED"
  );
}

function isSuccessfulHttpStatus(value: unknown): boolean {
  const status = asNumber(value);
  return status !== undefined && status >= 200 && status < 300;
}

function isSupportedHtmlContentType(value: unknown): boolean {
  return typeof value === "string" && /(?:^|;|\s)text\/html\b/i.test(value);
}

function isSemanticRoot(value: unknown): boolean {
  return value === "main" || value === "article" || value === "role_main";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
