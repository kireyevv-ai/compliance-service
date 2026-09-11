import { describe, expect, it } from "vitest";
import { classifySemanticEvidenceCompleteness } from "@/semantic-evaluator/completeness";

const completeHtmlMetadata = {
  documentType: "HTML",
  fetchStatus: 200,
  fetchContentType: "text/html; charset=utf-8",
  contentLimited: false,
  interstitialDetected: false,
  extractionSucceeded: true,
  extractionRoot: "main",
  extractionRootFallback: false,
  truncated: false,
  originalTextLength: 1200,
  maxChars: 50_000
};

describe("semantic evidence completeness classifier", () => {
  it("classifies normal HTML policy with a good semantic root as COMPLETE", () => {
    expect(classifySemanticEvidenceCompleteness(completeHtmlMetadata)).toBe("COMPLETE");
  });

  it("does not produce false COMPLETE when metadata is missing", () => {
    expect(classifySemanticEvidenceCompleteness({ truncated: false })).toBe("UNKNOWN");
  });

  it("keeps old evidence without new metadata as UNKNOWN or TRUNCATED", () => {
    expect(classifySemanticEvidenceCompleteness({ truncated: false, originalTextLength: 100, maxChars: 50_000 })).toBe("UNKNOWN");
    expect(classifySemanticEvidenceCompleteness({ truncated: true, originalTextLength: 60_000, maxChars: 50_000 })).toBe("TRUNCATED");
  });

  it("never treats body fallback as COMPLETE", () => {
    expect(
      classifySemanticEvidenceCompleteness({
        ...completeHtmlMetadata,
        extractionRoot: "body",
        extractionRootFallback: true
      })
    ).toBe("UNKNOWN");
  });

  it("classifies interstitial or content-limited policy evidence as PARTIAL", () => {
    expect(classifySemanticEvidenceCompleteness({ ...completeHtmlMetadata, interstitialDetected: true })).toBe("PARTIAL");
    expect(
      classifySemanticEvidenceCompleteness({
        ...completeHtmlMetadata,
        contentLimited: true,
        limitationReason: "RESPONSE_BODY_TOO_LARGE"
      })
    ).toBe("PARTIAL");
  });

  it("classifies text over the semantic cap as TRUNCATED", () => {
    expect(
      classifySemanticEvidenceCompleteness({
        ...completeHtmlMetadata,
        truncated: false,
        originalTextLength: 50_001,
        maxChars: 50_000
      })
    ).toBe("TRUNCATED");
  });

  it("keeps unsupported documents and timeout/no-evidence situations away from COMPLETE", () => {
    expect(classifySemanticEvidenceCompleteness({ ...completeHtmlMetadata, documentType: "PDF" })).toBe("UNKNOWN");
    expect(classifySemanticEvidenceCompleteness({ documentType: "HTML", limitationReason: "HTTP request timeout" })).toBe("UNKNOWN");
  });

  it("does not let global crawl maxPagesReached alone downgrade an otherwise complete policy page", () => {
    expect(classifySemanticEvidenceCompleteness({ ...completeHtmlMetadata, crawlMaxPagesReached: true })).toBe("COMPLETE");
  });
});
