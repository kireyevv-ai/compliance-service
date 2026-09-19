import { describe, expect, it } from "vitest";
import type { Scan } from "@/db/schema";
import type { Evidence } from "@/evidence/types";
import type { Fact } from "@/facts/types";
import { loadPilotSemanticRuntimeRules, loadRuntimeRules } from "@/legal-rules/runtime";
import { evaluateRulesForScan } from "@/rule-engine/evaluator";
import { FakeSemanticModelProvider } from "@/semantic-evaluator/fake-provider";
import {
  evaluateSemanticRulesShadow,
  SEMANTIC_SHADOW_TOTAL_EVIDENCE_TEXT_LIMIT
} from "@/semantic-evaluator/shadow";
import type { SemanticModelRequest } from "@/semantic-evaluator/types";

const pilotRuleIds = [
  "PD-005",
  "PD-008",
  "PD-009",
  "PD-010",
  "PD-013",
  "PD-014",
  "PD-015",
  "PD-016",
  "PD-017",
  "PD-018",
  "PD-019",
  "PD-024",
  "EC-010",
  "EC-012",
  "REC-003",
  "LANG-001"
] as const;

const scan: Scan = {
  id: "scan-1",
  siteId: "site-1",
  status: "RUNNING",
  statusReason: null,
  siteType: "B2B",
  scannerVersion: "semantic-shadow-test",
  startedAt: new Date("2026-09-10T00:00:00.000Z"),
  finishedAt: null,
  createdAt: new Date("2026-09-10T00:00:00.000Z")
};

function goldenProvider() {
  return new FakeSemanticModelProvider((request: SemanticModelRequest) => {
    const text = request.evidence.map((item) => item.excerpt).join("\n");
    const evidenceRefs = request.evidence.map((item) => item.ref);

    if (text.includes("GOLDEN_PASS")) {
      return semanticResponse("PRESENT", evidenceRefs);
    }

    if (text.includes("GOLDEN_FAIL")) {
      return semanticResponse("ABSENT", evidenceRefs);
    }

    return semanticResponse("AMBIGUOUS", evidenceRefs, "AMBIGUOUS_SYNTHETIC");
  });
}

function semanticResponse(observation: "PRESENT" | "ABSENT" | "AMBIGUOUS", evidenceRefs: string[], reasonCode = `${observation}_SYNTHETIC`) {
  return {
    observation,
    confidence: observation === "AMBIGUOUS" ? 0.45 : 0.86,
    reason_code: reasonCode,
    reason: "Synthetic golden semantic result.",
    evidence_refs: evidenceRefs
  };
}

function semanticFixture(ruleId: (typeof pilotRuleIds)[number], marker: "GOLDEN_PASS" | "GOLDEN_FAIL" | "GOLDEN_MANUAL") {
  const factType =
    ruleId === "PD-010"
      ? "marketing_consent_control_found"
      : ruleId === "PD-024"
        ? "form_fields"
      : ruleId === "EC-010" || ruleId === "LANG-001"
        ? "consumer_page_text"
      : ruleId === "EC-012"
        ? "paid_addon_control_found"
      : ruleId === "REC-003"
        ? "recommendation_rules_text"
        : ruleId === "PD-017"
          ? "form_fields"
        : ruleId === "PD-018"
          ? "external_service_matches"
      : ["PD-005", "PD-008", "PD-009"].includes(ruleId)
        ? "consent_text"
        : "privacy_policy_text";
  const text =
    ["PD-005", "PD-008", "PD-009"].includes(ruleId)
      ? `${marker}: согласие на обработку персональных данных рядом с формой.`
      : ruleId === "PD-010"
        ? `${marker}: согласие на рекламную рассылку рядом с формой.`
        : ruleId === "PD-024"
          ? `${marker}: форма содержит поле диагноз пациента.`
        : ruleId === "EC-010"
          ? `${marker}: порядок подачи претензий и жалоб покупателя.`
        : ruleId === "EC-012"
          ? `${marker}: платная дополнительная услуга в корзине.`
        : ruleId === "REC-003"
          ? `${marker}: правила рекомендательных технологий опубликованы на русском языке.`
        : ruleId === "LANG-001"
          ? `${marker}: потребительская информация на русском языке.`
        : ruleId === "PD-017"
          ? `${marker}: форма собирает имя и телефон; политика описывает имя и телефон.`
          : ruleId === "PD-018"
            ? `${marker}: внешний сервис аналитики отражён в политике.`
            : ruleId === "PD-019"
              ? `${marker}: Персональные данные третьим лицам не передаются. Найденные сервисы согласованы.`
      : `${marker}: политика обработки персональных данных, содержательный текст документа.`;
  const fact: Fact = {
    id: `fact-${ruleId}`,
    scanId: scan.id,
    pageUrl: "https://example.test/privacy",
    factType,
    value: {
      text,
      sourceUrl: "https://example.test/privacy",
      truncated: false,
      originalTextLength: text.length,
      maxChars: 50_000
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };
  const evidence: Evidence = {
    id: `evidence-${ruleId}`,
    scanId: scan.id,
    factId: fact.id,
    evidenceType: "TEXT_FRAGMENT",
    pageUrl: "https://example.test/privacy",
    payload: {
      kind: factType,
      text,
      context: text,
      sourceUrl: "https://example.test/privacy",
      truncated: false,
      originalTextLength: text.length,
      maxChars: 50_000
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };

  return { fact, evidence };
}

function policyFixtureWithText(id: string, text: string, sourceUrl = "https://example.test/privacy?token=secret#section") {
  const fact: Fact = {
    id: `fact-policy-${id}`,
    scanId: scan.id,
    pageUrl: sourceUrl,
    factType: "privacy_policy_text",
    value: {
      text,
      sourceUrl,
      truncated: false,
      originalTextLength: text.length,
      textLength: text.length,
      maxChars: 50_000
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };
  const evidence: Evidence = {
    id: `evidence-policy-${id}`,
    scanId: scan.id,
    factId: fact.id,
    evidenceType: "TEXT_FRAGMENT",
    pageUrl: sourceUrl,
    payload: {
      kind: "privacy_policy_text",
      text,
      context: text,
      sourceUrl,
      truncated: false,
      originalTextLength: text.length,
      textLength: text.length,
      maxChars: 50_000
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };

  return { fact, evidence };
}

function structuredFixture(id: string, factType: string, value: Record<string, unknown>) {
  const fact: Fact = {
    id: `fact-structured-${id}`,
    scanId: scan.id,
    pageUrl: "https://example.test/form",
    factType,
    value: {
      ...value,
      semanticCompleteness: "COMPLETE"
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };
  const evidence: Evidence = {
    id: `evidence-structured-${id}`,
    scanId: scan.id,
    factId: fact.id,
    evidenceType: "TEXT_FRAGMENT",
    pageUrl: "https://example.test/form",
    payload: {
      kind: factType,
      semanticCompleteness: "COMPLETE"
    },
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };

  return { fact, evidence };
}

function ruleOnly(ruleId: string) {
  return loadPilotSemanticRuntimeRules().filter((rule) => rule.ruleId === ruleId);
}

function scanForRule(ruleId: string): Scan {
  if (ruleId.startsWith("EC-") || ruleId.startsWith("LANG-")) {
    return { ...scan, siteType: "ECOMMERCE" };
  }
  return scan;
}

describe("pilot semantic rules shadow mode", () => {
  it.each(pilotRuleIds)("loads %s as an LLM_SEMANTIC runtime rule", (ruleId) => {
    const [rule] = ruleOnly(ruleId);

    expect(rule).toMatchObject({
      ruleId,
      evaluatorType: "LLM_SEMANTIC",
      evaluation: expect.objectContaining({
        kind: "SEMANTIC_CRITERION",
        criterion: expect.any(String)
      })
    });
  });

  it.each(
    pilotRuleIds.flatMap((ruleId) => [
      [ruleId, "GOLDEN_PASS", ruleId === "PD-024" ? "MANUAL_CHECK" : "PASS"],
      [ruleId, "GOLDEN_FAIL", "MANUAL_CHECK"],
      [ruleId, "GOLDEN_MANUAL", "MANUAL_CHECK"]
    ] as const)
  )("%s returns %s for %s golden evidence", async (ruleId, marker, expectedStatus) => {
    const { fact, evidence } = semanticFixture(ruleId, marker);
    const facts = ruleId === "REC-003"
      ? [factForDeterministic("recommendation_technology_confirmed", { found: true }), fact]
      : [fact];

    const [result] = await evaluateSemanticRulesShadow({
      scan: scanForRule(ruleId),
      facts,
      evidence: [evidence],
      rules: ruleOnly(ruleId),
      provider: goldenProvider()
    });

    expect(result).toMatchObject({
      ruleId,
      status: expectedStatus
    });
    expect(result.evidenceRefs).toEqual([`${fact.factType}:${evidence.id}`]);
  });

  it("builds scoped evidence packages and does not pass unrelated evidence", async () => {
    const provider = goldenProvider();
    const consent = semanticFixture("PD-008", "GOLDEN_PASS");
    const policy = semanticFixture("PD-013", "GOLDEN_PASS");

    await evaluateSemanticRulesShadow({
      scan,
      facts: [consent.fact, policy.fact],
      evidence: [consent.evidence, policy.evidence],
      rules: ruleOnly("PD-008"),
      provider
    });

    expect(provider.requests[0].evidence).toHaveLength(1);
    expect(provider.requests[0].evidence[0]).toMatchObject({
      ref: `consent_text:${consent.evidence.id}`,
      excerpt: expect.stringContaining("GOLDEN_PASS")
    });
  });

  it("turns provider failure into shadow NO_EVALUATION", async () => {
    const { fact, evidence } = semanticFixture("PD-013", "GOLDEN_PASS");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider: new FakeSemanticModelProvider(() => {
        throw new Error("provider unavailable");
      })
    });

    expect(result).toMatchObject({
      ruleId: "PD-013",
      status: "NO_EVALUATION",
      result: expect.objectContaining({
        technicalErrorCode: "PROVIDER_ERROR"
      })
    });
  });

  it("does not allow truncated policy evidence to produce shadow FAIL", async () => {
    const { fact, evidence } = semanticFixture("PD-013", "GOLDEN_FAIL");
    fact.value.truncated = true;
    evidence.payload = { ...evidence.payload, truncated: true };

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider: goldenProvider()
    });

    expect(result).toMatchObject({
      status: "MANUAL_CHECK",
      result: expect.objectContaining({
        observation: "ABSENT"
      })
    });
  });

  it("allows COMPLETE policy evidence with ABSENT observation to produce shadow FAIL", async () => {
    const { fact, evidence } = policyFixtureWithText("complete-absent", "GOLDEN_FAIL policy text without required purpose");
    const completeMetadata = {
      documentType: "HTML",
      fetchStatus: 200,
      fetchContentType: "text/html",
      contentLimited: false,
      interstitialDetected: false,
      extractionSucceeded: true,
      extractionRoot: "main",
      extractionRootFallback: false,
      truncated: false,
      originalTextLength: fact.value.originalTextLength,
      maxChars: 50_000
    };
    fact.value = { ...fact.value, ...completeMetadata };
    evidence.payload = { ...evidence.payload, ...completeMetadata };

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider: goldenProvider()
    });

    expect(result).toMatchObject({
      status: "FAIL",
      result: expect.objectContaining({
        observation: "ABSENT"
      })
    });
  });

  it("passes policy text to the provider only through evidence excerpts", async () => {
    const marker = "UNIQUE_POLICY_RAW_TEXT_MARKER";
    const provider = goldenProvider();
    const { fact, evidence } = policyFixtureWithText("single-raw", `GOLDEN_PASS ${marker}`);

    await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider
    });

    const requestJson = JSON.stringify(provider.requests[0]);
    expect(provider.requests[0].evidence[0].excerpt).toContain(marker);
    expect(provider.requests[0].facts?.[0].value).not.toHaveProperty("text");
    expect(provider.requests[0].facts?.[0].value).not.toHaveProperty("context");
    expect((requestJson.match(new RegExp(marker, "g")) ?? [])).toHaveLength(1);
  });

  it("removes query strings and fragments from model-facing source URLs", async () => {
    const provider = goldenProvider();
    const { fact, evidence } = policyFixtureWithText(
      "sanitized-url",
      "GOLDEN_PASS policy text",
      "https://example.test/privacy/path?email=user@example.test&token=secret#consent"
    );

    await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider
    });

    expect(provider.requests[0].evidence[0]).toMatchObject({
      pageUrl: "https://example.test/privacy/path",
      metadata: expect.objectContaining({
        sourceUrl: "https://example.test/privacy/path"
      })
    });
    expect(provider.requests[0].facts?.[0]).toMatchObject({
      pageUrl: "https://example.test/privacy/path",
      value: expect.objectContaining({
        sourceUrl: "https://example.test/privacy/path"
      })
    });
    expect(JSON.stringify(provider.requests[0])).not.toContain("token=secret");
    expect(JSON.stringify(provider.requests[0])).not.toContain("#consent");
  });

  it("evaluates semantic shadow requests below the total evidence text cap", async () => {
    const provider = goldenProvider();
    const text = `GOLDEN_PASS ${"а".repeat(SEMANTIC_SHADOW_TOTAL_EVIDENCE_TEXT_LIMIT - 100)}`;
    const { fact, evidence } = policyFixtureWithText("under-cap", text);

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("PD-013"),
      provider
    });

    expect(result.status).toBe("PASS");
    expect(provider.requests).toHaveLength(1);
  });

  it("returns NO_EVALUATION/INPUT_TOO_LARGE and does not call provider when semantic evidence exceeds the total cap", async () => {
    const provider = goldenProvider();
    const first = policyFixtureWithText("over-cap-a", `GOLDEN_PASS ${"а".repeat(31_000)}`);
    const second = policyFixtureWithText("over-cap-b", `GOLDEN_PASS ${"б".repeat(31_000)}`);

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [first.fact, second.fact],
      evidence: [first.evidence, second.evidence],
      rules: ruleOnly("PD-013"),
      provider
    });

    expect(result).toMatchObject({
      status: "NO_EVALUATION",
      result: expect.objectContaining({
        technicalErrorCode: "INPUT_TOO_LARGE"
      })
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("passes both form/category and policy evidence to PD-017 without losing provenance", async () => {
    const provider = goldenProvider();
    const form = structuredFixture("form-fields", "form_fields", {
      formIndex: 0,
      fields: [
        { type: "text", name: "name", label: "Имя", personalDataCategories: ["name"] },
        { type: "email", name: "email", label: "E-mail", personalDataCategories: ["email"] },
        { type: "hidden", name: "csrf", personalDataCategories: [] }
      ]
    });
    const policy = policyFixtureWithText("pd017-policy", "GOLDEN_PASS Политика описывает имя и адрес электронной почты.");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [form.fact, policy.fact],
      evidence: [form.evidence, policy.evidence],
      rules: ruleOnly("PD-017"),
      provider
    });

    expect(result.status).toBe("PASS");
    expect(provider.requests[0].evidence.map((item) => item.ref)).toEqual([
      `form_fields:${form.evidence.id}`,
      `privacy_policy_text:${policy.evidence.id}`
    ]);
    expect(provider.requests[0].evidence[0].excerpt).toContain("name");
    expect(provider.requests[0].evidence[0].excerpt).toContain("email");
    expect(provider.requests[0].evidence[0].excerpt).not.toContain("csrf");
  });

  it("passes both service and policy evidence to PD-018 without cross-binding", async () => {
    const provider = goldenProvider();
    const service = structuredFixture("service-match", "external_service_matches", {
      service_name: "Yandex Metrica",
      category: "analytics",
      signal_type: "SCRIPT",
      matched_host: "mc.yandex.ru",
      provider_scope: "RU_PROVIDER"
    });
    const policy = policyFixtureWithText("pd018-policy", "GOLDEN_PASS Политика раскрывает сервисы аналитики.");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [service.fact, policy.fact],
      evidence: [service.evidence, policy.evidence],
      rules: ruleOnly("PD-018"),
      provider
    });

    expect(result.status).toBe("PASS");
    expect(provider.requests[0].evidence.map((item) => item.ref)).toEqual([
      `external_service_matches:${service.evidence.id}`,
      `privacy_policy_text:${policy.evidence.id}`
    ]);
    expect(provider.requests[0].evidence[0].excerpt).toContain("Yandex Metrica");
    expect(provider.requests[0].evidence[0].metadata).toMatchObject({
      factType: "external_service_matches",
      serviceName: "Yandex Metrica",
      serviceCategory: "analytics"
    });
  });

  it("does not evaluate PD-019 when policy has no explicit no-transfer claim", async () => {
    const provider = goldenProvider();
    const service = structuredFixture("pd019-service", "external_service_matches", {
      service_name: "Yandex Metrica",
      category: "analytics",
      signal_type: "SCRIPT",
      matched_host: "mc.yandex.ru",
      provider_scope: "RU_PROVIDER"
    });
    const policy = policyFixtureWithText("pd019-policy-no-claim", "Политика раскрывает цели обработки и категории данных.");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [service.fact, policy.fact],
      evidence: [service.evidence, policy.evidence],
      rules: ruleOnly("PD-019"),
      provider
    });

    expect(result.status).toBe("NO_EVALUATION");
    expect(provider.requests).toHaveLength(0);
  });

  it("evaluates PD-019 when policy contains an explicit no-transfer claim", async () => {
    const provider = goldenProvider();
    const service = structuredFixture("pd019-service-claim", "external_service_matches", {
      service_name: "Yandex Metrica",
      category: "analytics",
      signal_type: "SCRIPT",
      matched_host: "mc.yandex.ru",
      provider_scope: "RU_PROVIDER"
    });
    const policy = policyFixtureWithText("pd019-policy-claim", "GOLDEN_PASS Персональные данные третьим лицам не передаются.");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [service.fact, policy.fact],
      evidence: [service.evidence, policy.evidence],
      rules: ruleOnly("PD-019"),
      provider
    });

    expect(result.status).toBe("PASS");
    expect(provider.requests).toHaveLength(1);
  });

  it("keeps PD-024 special-category signal as MANUAL_CHECK rather than FAIL", async () => {
    const provider = goldenProvider();
    const form = structuredFixture("pd024-special-field", "form_fields", {
      formIndex: 0,
      fields: [
        { type: "text", name: "diagnosis", label: "Диагноз", personalDataCategories: [] },
        { type: "hidden", name: "csrf", personalDataCategories: [] }
      ]
    });

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [form.fact],
      evidence: [form.evidence],
      rules: ruleOnly("PD-024"),
      provider
    });

    expect(result.status).toBe("MANUAL_CHECK");
    expect(provider.requests[0].evidence[0].excerpt).toContain("Диагноз");
    expect(provider.requests[0].evidence[0].excerpt).not.toContain("csrf");
  });

  it("does not evaluate REC-003 until recommendation technology use is confirmed", async () => {
    const provider = goldenProvider();
    const { fact, evidence } = semanticFixture("REC-003", "GOLDEN_PASS");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [fact],
      evidence: [evidence],
      rules: ruleOnly("REC-003"),
      provider
    });

    expect(result.status).toBe("NO_EVALUATION");
    expect(provider.requests).toHaveLength(0);
  });

  it("keeps REC-003 at MANUAL_CHECK when a rules document link exists but text is unavailable", async () => {
    const provider = goldenProvider();
    const documentLink = structuredFixture("rec003-document-link", "recommendation_rules_document_link", {
      found: true,
      url: "https://example.test/recommendation-rules"
    });

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [
        factForDeterministic("recommendation_technology_confirmed", { found: true }),
        documentLink.fact
      ],
      evidence: [documentLink.evidence],
      rules: ruleOnly("REC-003"),
      provider
    });

    expect(result.status).toBe("MANUAL_CHECK");
    expect(result.result.status).toBe("MANUAL_CHECK");
    expect(result.evidenceRefs).toEqual([`recommendation_rules_document_link:${documentLink.evidence.id}`]);
    expect(provider.requests).toHaveLength(0);
  });

  it("does not invoke REC-003 when confirmed use exists but no rules document is found", async () => {
    const provider = goldenProvider();

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [factForDeterministic("recommendation_technology_confirmed", { found: true })],
      evidence: [],
      rules: ruleOnly("REC-003"),
      provider
    });

    expect(result.status).toBe("NO_EVALUATION");
    expect(provider.requests).toHaveLength(0);
  });

  it("evaluates CK-001 only with relevant cookie or tracker evidence and policy text", async () => {
    const provider = goldenProvider();
    const cookies = structuredFixture("ck001-cookies", "cookie_metadata", {
      cookieNames: ["_ga", "_ym_uid"]
    });
    const policy = policyFixtureWithText("ck001-policy", "GOLDEN_PASS Политика раскрывает cookie и аналитические идентификаторы.");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [cookies.fact, policy.fact],
      evidence: [cookies.evidence, policy.evidence],
      rules: ruleOnly("CK-001"),
      provider
    });

    expect(result.status).toBe("PASS");
    expect(provider.requests[0].evidence.map((item) => item.ref)).toEqual([
      `cookie_metadata:${cookies.evidence.id}`,
      `privacy_policy_text:${policy.evidence.id}`
    ]);
    expect(provider.requests[0].evidence[0].excerpt).toContain("_ga");
  });

  it("does not evaluate CK-001 for ordinary technical cookies only", async () => {
    const provider = goldenProvider();
    const cookies = structuredFixture("ck001-technical-cookie", "cookie_metadata", {
      cookieNames: ["csrf_token"]
    });
    const policy = policyFixtureWithText("ck001-technical-policy", "GOLDEN_FAIL Политика не упоминает cookie.");

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [cookies.fact, policy.fact],
      evidence: [cookies.evidence, policy.evidence],
      rules: ruleOnly("CK-001"),
      provider
    });

    expect(result.status).toBe("NO_EVALUATION");
    expect(provider.requests).toHaveLength(0);
  });

  it("keeps CK-001 absence as MANUAL_CHECK when policy evidence is incomplete", async () => {
    const provider = goldenProvider();
    const cookies = structuredFixture("ck001-incomplete-cookies", "cookie_metadata", {
      cookieNames: ["_ga"]
    });
    const policy = policyFixtureWithText("ck001-incomplete-policy", "GOLDEN_FAIL Раздел о cookie приведён далее.");
    policy.fact.value = { ...policy.fact.value, semanticCompleteness: "PARTIAL" };
    policy.evidence.payload = { ...policy.evidence.payload, semanticCompleteness: "PARTIAL" };

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [cookies.fact, policy.fact],
      evidence: [cookies.evidence, policy.evidence],
      rules: ruleOnly("CK-001"),
      provider
    });

    expect(result.status).toBe("MANUAL_CHECK");
    expect(result.result).toMatchObject({ observation: "ABSENT" });
  });

  it("evaluates CK-004 for cookie consent bundled with mandatory terms", async () => {
    const provider = goldenProvider();
    const consent = structuredFixture("ck004-consent", "rendered_consent_text", {
      text: "GOLDEN_FAIL Один обязательный флажок: принимаю оферту и соглашаюсь на cookie для аналитики.",
      formIndex: 0,
      controlIndex: 1
    });

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [consent.fact],
      evidence: [consent.evidence],
      rules: ruleOnly("CK-004"),
      provider
    });

    expect(result.status).toBe("FAIL");
    expect(provider.requests).toHaveLength(1);
  });

  it("does not evaluate CK-004 from cookie evidence without consent wording", async () => {
    const provider = goldenProvider();
    const cookies = structuredFixture("ck004-cookie-only", "cookie_metadata", {
      cookieNames: ["_ga"]
    });

    const [result] = await evaluateSemanticRulesShadow({
      scan,
      facts: [cookies.fact],
      evidence: [cookies.evidence],
      rules: ruleOnly("CK-004"),
      provider
    });

    expect(result.status).toBe("NO_EVALUATION");
    expect(provider.requests).toHaveLength(0);
  });

  it("keeps deterministic evaluation separate from semantic shadow mode", async () => {
    const deterministicEvaluations = evaluateRulesForScan({
      scan,
      rules: loadRuntimeRules(),
      facts: [
        factForDeterministic("scan_coverage", { crawlCompleted: true, contentLimited: false, successfulHtmlPages: 1, httpErrorPages: 0 }),
        factForDeterministic("personal_data_collection_found", { found: true }),
        factForDeterministic("privacy_policy_link_found", { found: true })
      ],
      evidence: []
    });
    const shadowResults = await evaluateSemanticRulesShadow({
      scan,
      facts: [],
      evidence: [],
      provider: new FakeSemanticModelProvider(() => {
        throw new Error("semantic provider should not be needed without semantic evidence");
      })
    });

    expect(deterministicEvaluations.find((item) => item.ruleId === "PD-001")?.status).toBe("PASS");
    expect(shadowResults.some((item) => item.ruleId === "PD-001")).toBe(false);
  });
});

function factForDeterministic(factType: string, value: Record<string, unknown>): Fact {
  return {
    id: `fact-${factType}`,
    scanId: scan.id,
    factType,
    value,
    createdAt: new Date("2026-09-10T00:00:00.000Z")
  };
}
