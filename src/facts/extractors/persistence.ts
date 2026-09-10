import { createEvidence, createFact } from "@/db/repository";
import type { Queryable } from "@/db/client";
import type { ExtractedFact, StaticExtractionResult } from "./types";

export async function persistStaticExtraction(
  db: Queryable,
  scanId: string,
  result: StaticExtractionResult
): Promise<{ factCount: number; evidenceCount: number }> {
  let evidenceCount = 0;

  for (const extractedFact of result.facts) {
    const fact = await createFact(db, {
      scanId,
      pageUrl: extractedFact.pageUrl,
      factType: extractedFact.factType,
      value: sanitizeJson(extractedFact.value)
    });

    for (const evidence of extractedFact.evidence) {
      await createEvidence(db, {
        scanId,
        factId: fact.id,
        evidenceType: evidence.evidenceType,
        pageUrl: evidence.pageUrl,
        payload: sanitizeJson(evidence.payload),
        storageRef: evidence.storageRef
      });
      evidenceCount += 1;
    }
  }

  return { factCount: result.facts.length, evidenceCount };
}

export function countExtractedFacts(result: StaticExtractionResult, factType: ExtractedFact["factType"]): number {
  return result.facts.filter((fact) => fact.factType === factType).length;
}

function sanitizeJson(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(value) as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return maskPhone(maskEmail(value));
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [key, sanitizeValue(childValue)])
    );
  }

  return value;
}

function maskEmail(value: string): string {
  return value.replace(
    /([A-Z0-9._%+-])([A-Z0-9._%+-]*)(@[A-Z0-9.-]+\.[A-Z]{2,})/giu,
    (_match, first: string, _rest: string, domain: string) => `${first}***${domain.toLowerCase()}`
  );
}

function maskPhone(value: string): string {
  return value.replace(/(?:\+7|8)\s*(?:\(?\d{3}\)?)[\s-]*\d{3}[\s-]*\d{2}[\s-]*(\d{2})/gu, "+7 *** *** ** $1");
}
