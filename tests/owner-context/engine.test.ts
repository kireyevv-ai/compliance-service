import { readFileSync } from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { Queryable } from "@/db/client";
import {
  createQueuedScan,
  createSite,
  getOwnerAnswersForScan,
  upsertOwnerAnswer,
  upsertUser
} from "@/db/repository";
import type { SiteType } from "@/db/schema";
import type { Fact } from "@/facts/types";
import {
  evaluateOwnerRules,
  getOwnerQuestionApplicability,
  getRequiredOwnerQuestions,
  OWNER_RULE_MAPPINGS
} from "@/owner-context/engine";
import { OWNER_QUESTIONS } from "@/owner-context/questions";
import type { OwnerAnswer, OwnerAnswerValue, OwnerContextInput } from "@/owner-context/types";

function createTestDb(): Queryable {
  const db = newDb();
  for (const file of ["001_initial_schema.sql", "002_owner_answers.sql"]) {
    db.public.none(readFileSync(path.join(process.cwd(), "src", "db", "migrations", file), "utf8"));
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

async function createScan(db: Queryable, siteType: SiteType = "B2B") {
  const user = await upsertUser(db, { email: "owner-context@example.test" });
  const site = await createSite(db, {
    userId: user.id,
    url: "https://example.test/",
    normalizedDomain: "example.test"
  });
  return createQueuedScan(db, { siteId: site.id, siteType, scannerVersion: "owner-context-test" });
}

function fact(factType: string, value: Record<string, unknown> = { found: true }): Fact {
  return {
    id: `00000000-0000-4000-8000-${String(Math.abs(hash(factType))).padStart(12, "0").slice(0, 12)}`,
    scanId: "00000000-0000-4000-8000-000000000001",
    pageUrl: "https://example.test/",
    factType,
    value,
    createdAt: new Date("2026-09-14T12:00:00Z")
  };
}

function hash(value: string): number {
  return [...value].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function answer(questionId: string, value: OwnerAnswerValue): OwnerAnswer {
  return {
    id: `${questionId}-answer`,
    scanId: "00000000-0000-4000-8000-000000000001",
    questionId,
    answer: value,
    provenance: "OWNER",
    answeredAt: new Date("2026-09-14T12:00:00Z"),
    updatedAt: new Date("2026-09-14T12:00:00Z")
  };
}

function context(input: {
  siteType?: SiteType;
  facts?: readonly Fact[];
  answers?: readonly OwnerAnswer[];
} = {}): OwnerContextInput {
  return {
    siteType: input.siteType ?? "B2B",
    facts: [...(input.facts ?? [])],
    answers: [...(input.answers ?? [])]
  };
}

function statusFor(result: ReturnType<typeof evaluateOwnerRules>, ruleId: string) {
  return result.find((item) => item.ruleId === ruleId)?.status;
}

function evaluationFor(result: ReturnType<typeof evaluateOwnerRules>, ruleId: string) {
  const evaluation = result.find((item) => item.ruleId === ruleId);
  if (!evaluation) {
    throw new Error(`Missing evaluation for ${ruleId}`);
  }
  return evaluation;
}

describe("owner question registry", () => {
  it("defines the 9 core owner questions with only supported structured answer types", () => {
    expect(OWNER_QUESTIONS).toHaveLength(9);
    expect(OWNER_QUESTIONS.map((question) => question.questionId)).toEqual([
      "Q_PD_COLLECTION_LEGAL_BASIS",
      "Q_MARKETING_CONSENT_PROOF",
      "Q_PD_PRIMARY_DB_LOCATION",
      "Q_PD_OPERATOR_RKN_NOTIFICATION",
      "Q_AD_MATERIAL_QUALIFICATION",
      "Q_AUTH_OWNER_STATUS",
      "Q_AUTH_METHODS",
      "Q_RECOMMENDER_TECH_USE",
      "Q_LANGUAGE_EXCEPTION"
    ]);
    expect(new Set(OWNER_QUESTIONS.map((question) => question.answerType))).toEqual(
      new Set(["SINGLE_SELECT", "MULTI_SELECT"])
    );
  });

  it("maps 13 OWNER_MANUAL rules and reuses shared questions across rules", () => {
    expect(OWNER_RULE_MAPPINGS.map((mapping) => mapping.ruleId)).toEqual([
      "PD-007",
      "PD-012",
      "PD-022",
      "PD-023",
      "ADV-001",
      "ADV-002",
      "ADV-003",
      "ADV-004",
      "AUTH-001",
      "REC-001",
      "REC-002",
      "REC-004",
      "LANG-002"
    ]);

    expect(
      OWNER_RULE_MAPPINGS.filter((mapping) =>
        mapping.questionIds.includes("Q_MARKETING_CONSENT_PROOF")
      ).map((mapping) => mapping.ruleId)
    ).toEqual(["PD-012", "ADV-004"]);
    expect(
      OWNER_RULE_MAPPINGS.filter((mapping) =>
        mapping.questionIds.includes("Q_AD_MATERIAL_QUALIFICATION")
      ).map((mapping) => mapping.ruleId)
    ).toEqual(["ADV-001", "ADV-002", "ADV-003"]);
    expect(
      OWNER_RULE_MAPPINGS.filter((mapping) =>
        mapping.questionIds.includes("Q_RECOMMENDER_TECH_USE")
      ).map((mapping) => mapping.ruleId)
    ).toEqual(["REC-001", "REC-002", "REC-004"]);
  });
});

describe("owner answer storage", () => {
  it("stores scan-scoped structured OWNER answers and allows updates", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    const first = await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      answer: { type: "SINGLE_SELECT", optionId: "SEPARATE_CONSENT" }
    });
    const updated = await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
    });
    const stored = await getOwnerAnswersForScan(db, scan.id);

    expect(updated.id).toBe(first.id);
    expect(updated.provenance).toBe("OWNER");
    expect(stored).toHaveLength(1);
    expect(stored[0].answer).toEqual({ type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" });
  });

  it("validates structured answers and rejects invalid options", async () => {
    const db = createTestDb();
    const scan = await createScan(db);

    await expect(
      upsertOwnerAnswer(db, {
        scanId: scan.id,
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "MULTI_SELECT", optionIds: ["PROOF_STORED"] }
      })
    ).rejects.toThrow("expects SINGLE_SELECT");

    await expect(
      upsertOwnerAnswer(db, {
        scanId: scan.id,
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "MADE_UP_OPTION" }
      })
    ).rejects.toThrow("Invalid option");
  });

  it("rejects NO_AUTH combined with another auth method", async () => {
    const db = createTestDb();
    const scan = await createScan(db);

    await expect(
      upsertOwnerAnswer(db, {
        scanId: scan.id,
        questionId: "Q_AUTH_METHODS",
        answer: { type: "MULTI_SELECT", optionIds: ["NO_AUTH", "ESIA"] }
      })
    ).rejects.toThrow("Exclusive option NO_AUTH cannot be combined");
  });

  it("rejects UNKNOWN combined with another auth method", async () => {
    const db = createTestDb();
    const scan = await createScan(db);

    await expect(
      upsertOwnerAnswer(db, {
        scanId: scan.id,
        questionId: "Q_AUTH_METHODS",
        answer: { unknown: true, type: "MULTI_SELECT", optionIds: ["FOREIGN_PROVIDERS_ONLY"] } as never
      })
    ).rejects.toThrow("Unknown answer for question Q_AUTH_METHODS must be exclusive");
  });

  it("accepts ESIA combined with another allowed auth method", async () => {
    const db = createTestDb();
    const scan = await createScan(db);

    const stored = await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_AUTH_METHODS",
      answer: { type: "MULTI_SELECT", optionIds: ["ESIA", "ALLOWED_RU_METHOD"] }
    });

    expect(stored.answer).toEqual({ type: "MULTI_SELECT", optionIds: ["ESIA", "ALLOWED_RU_METHOD"] });
  });

  it("accepts a single valid auth method option", async () => {
    const db = createTestDb();
    const scan = await createScan(db);

    const stored = await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_AUTH_METHODS",
      answer: { type: "MULTI_SELECT", optionIds: ["FOREIGN_PROVIDERS_ONLY"] }
    });

    expect(stored.answer).toEqual({ type: "MULTI_SELECT", optionIds: ["FOREIGN_PROVIDERS_ONLY"] });
  });
});

describe("owner context engine", () => {
  it("turns unknown answers into MANUAL_CHECK", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [fact("personal_data_collection_found")],
        answers: [answer("Q_PD_COLLECTION_LEGAL_BASIS", { unknown: true })]
      })
    );
    const evaluation = result.find((item) => item.ruleId === "PD-007")!;

    expect(evaluation.status).toBe("MANUAL_CHECK");
    expect(evaluation.reasonCode).toBe("OWNER_UNKNOWN");
  });

  it("keeps unanswered required questions unresolved instead of FAIL", () => {
    const result = evaluateOwnerRules(context({ facts: [fact("personal_data_collection_found")] }));
    const evaluation = result.find((item) => item.ruleId === "PD-007")!;

    expect(evaluation.status).toBe("UNRESOLVED");
    expect(evaluation.reasonCode).toBe("ANSWER_REQUIRED");
  });

  it("does not ask NOT_APPLICABLE questions when site facts make them irrelevant", () => {
    const noPd = context({ facts: [] });

    expect(getOwnerQuestionApplicability("Q_PD_COLLECTION_LEGAL_BASIS", noPd)).toBe("NOT_NEEDED");
    expect(getRequiredOwnerQuestions(noPd)).not.toContain("Q_PD_COLLECTION_LEGAL_BASIS");
    expect(statusFor(evaluateOwnerRules(noPd), "PD-007")).toBe("NOT_APPLICABLE");
  });

  it("keeps unresolved applicability from creating a false verdict", () => {
    const result = evaluateOwnerRules(context());
    const adEvaluation = result.find((item) => item.ruleId === "ADV-001")!;
    const recEvaluation = result.find((item) => item.ruleId === "REC-002")!;

    expect(adEvaluation.status).toBe("UNRESOLVED");
    expect(adEvaluation.reasonCode).toBe("APPLICABILITY_UNRESOLVED");
    expect(recEvaluation.status).toBe("UNRESOLVED");
    expect(recEvaluation.reasonCode).toBe("APPLICABILITY_UNRESOLVED");
  });

  it("produces PASS from a valid owner answer when applicability is proven", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [fact("personal_data_collection_found")],
        answers: [
          answer("Q_PD_COLLECTION_LEGAL_BASIS", {
            type: "SINGLE_SELECT",
            optionId: "CONTRACT_OR_REQUEST"
          })
        ]
      })
    );

    expect(statusFor(result, "PD-007")).toBe("PASS");
  });

  it("uses one marketing consent answer for PD-012 and ADV-004", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [fact("marketing_subscription_detected")],
        answers: [
          answer("Q_MARKETING_CONSENT_PROOF", {
            type: "SINGLE_SELECT",
            optionId: "PROOF_STORED"
          })
        ]
      })
    );

    expect(statusFor(result, "PD-012")).toBe("PASS");
    expect(statusFor(result, "ADV-004")).toBe("PASS");
  });

  it("turns owner/site conflicts into MANUAL_CHECK with reason code and site fact refs", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [fact("marketing_subscription_detected", { found: true, text: "Подписаться на акции" })],
        answers: [
          answer("Q_MARKETING_CONSENT_PROOF", {
            type: "SINGLE_SELECT",
            optionId: "NO_MARKETING"
          })
        ]
      })
    );
    const evaluation = result.find((item) => item.ruleId === "PD-012")!;

    expect(evaluation.status).toBe("MANUAL_CHECK");
    expect(evaluation.reasonCode).toBe("OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE");
    expect(evaluation.siteFactRefs).toEqual([
      {
        factId: expect.any(String),
        factType: "marketing_subscription_detected",
        pageUrl: "https://example.test/"
      }
    ]);
  });

  it("shows Q_AUTH_METHODS only after Q_AUTH_OWNER_STATUS makes auth requirement applicable", () => {
    const base = context({ facts: [fact("auth_ui_static_signal", { found: true })] });
    const nonRussianOwner = context({
      facts: [fact("auth_ui_static_signal", { found: true })],
      answers: [
        answer("Q_AUTH_OWNER_STATUS", {
          type: "SINGLE_SELECT",
          optionId: "NOT_RUSSIAN_OWNER"
        })
      ]
    });
    const russianOwner = context({
      facts: [fact("auth_ui_static_signal", { found: true })],
      answers: [
        answer("Q_AUTH_OWNER_STATUS", {
          type: "SINGLE_SELECT",
          optionId: "RUSSIAN_OWNER"
        })
      ]
    });

    expect(getOwnerQuestionApplicability("Q_AUTH_METHODS", base)).toBe("UNRESOLVED");
    expect(getRequiredOwnerQuestions(base)).toEqual(["Q_AUTH_OWNER_STATUS"]);
    expect(getOwnerQuestionApplicability("Q_AUTH_METHODS", nonRussianOwner)).toBe("NOT_NEEDED");
    expect(getRequiredOwnerQuestions(nonRussianOwner)).toEqual(["Q_AUTH_OWNER_STATUS"]);
    expect(getOwnerQuestionApplicability("Q_AUTH_METHODS", russianOwner)).toBe("REQUIRED");
    expect(getRequiredOwnerQuestions(russianOwner)).toEqual(["Q_AUTH_OWNER_STATUS", "Q_AUTH_METHODS"]);
  });

  it("returns NOT_APPLICABLE when auth owner status excludes the rule", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [fact("auth_ui_static_signal", { found: true })],
        answers: [
          answer("Q_AUTH_OWNER_STATUS", {
            type: "SINGLE_SELECT",
            optionId: "NOT_RUSSIAN_OWNER"
          })
        ]
      })
    );

    expect(statusFor(result, "AUTH-001")).toBe("NOT_APPLICABLE");
  });

  it("keeps legally ambiguous mappings at MANUAL_CHECK instead of hard FAIL", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [fact("recommendation_notice_candidate", { found: false })],
        answers: [
          answer("Q_RECOMMENDER_TECH_USE", {
            type: "SINGLE_SELECT",
            optionId: "USES_RECOMMENDER_TECH"
          })
        ]
      })
    );
    const evaluation = result.find((item) => item.ruleId === "REC-001")!;

    expect(evaluation.status).toBe("MANUAL_CHECK");
    expect(evaluation.reasonCode).toBe("RULE_POLICY_REQUIRES_MANUAL_CHECK");
  });

  it.each([
    {
      ruleId: "PD-007",
      facts: [fact("personal_data_collection_found")],
      answers: [
        answer("Q_PD_COLLECTION_LEGAL_BASIS", {
          type: "SINGLE_SELECT",
          optionId: "SEPARATE_CONSENT"
        })
      ],
      expectedStatus: "PASS"
    },
    {
      ruleId: "PD-012",
      facts: [fact("marketing_subscription_detected")],
      answers: [
        answer("Q_MARKETING_CONSENT_PROOF", {
          type: "SINGLE_SELECT",
          optionId: "PROOF_STORED"
        })
      ],
      expectedStatus: "PASS"
    },
    {
      ruleId: "PD-022",
      facts: [fact("personal_data_collection_found"), fact("foreign_provider_signal_found")],
      answers: [
        answer("Q_PD_PRIMARY_DB_LOCATION", {
          type: "SINGLE_SELECT",
          optionId: "RU_FIRST"
        })
      ],
      expectedStatus: "PASS"
    },
    {
      ruleId: "PD-023",
      facts: [fact("personal_data_collection_found"), fact("seller_legal_name_candidate")],
      answers: [
        answer("Q_PD_OPERATOR_RKN_NOTIFICATION", {
          type: "SINGLE_SELECT",
          optionId: "REGISTRY_PRESENT"
        })
      ],
      expectedStatus: "MANUAL_CHECK",
      expectedReasonCode: "RULE_POLICY_REQUIRES_MANUAL_CHECK"
    },
    {
      ruleId: "ADV-001",
      facts: [fact("ad_candidate_detected"), fact("ad_label_text_found", { found: false })],
      answers: [
        answer("Q_AD_MATERIAL_QUALIFICATION", {
          type: "SINGLE_SELECT",
          optionId: "IS_INTERNET_AD"
        })
      ],
      expectedStatus: "MANUAL_CHECK",
      expectedReasonCode: "RULE_POLICY_REQUIRES_MANUAL_CHECK"
    },
    {
      ruleId: "ADV-002",
      facts: [fact("ad_candidate_detected"), fact("advertiser_identity_or_link_found", { found: false })],
      answers: [
        answer("Q_AD_MATERIAL_QUALIFICATION", {
          type: "SINGLE_SELECT",
          optionId: "IS_INTERNET_AD"
        })
      ],
      expectedStatus: "MANUAL_CHECK",
      expectedReasonCode: "RULE_POLICY_REQUIRES_MANUAL_CHECK"
    },
    {
      ruleId: "ADV-003",
      facts: [fact("ad_candidate_detected"), fact("erid_token_candidate", { found: false })],
      answers: [
        answer("Q_AD_MATERIAL_QUALIFICATION", {
          type: "SINGLE_SELECT",
          optionId: "IS_INTERNET_AD"
        })
      ],
      expectedStatus: "MANUAL_CHECK",
      expectedReasonCode: "RULE_POLICY_REQUIRES_MANUAL_CHECK"
    },
    {
      ruleId: "ADV-004",
      facts: [fact("rendered_marketing_consent_found")],
      answers: [
        answer("Q_MARKETING_CONSENT_PROOF", {
          type: "SINGLE_SELECT",
          optionId: "PROOF_STORED"
        })
      ],
      expectedStatus: "PASS"
    },
    {
      ruleId: "AUTH-001",
      facts: [fact("auth_ui_static_signal")],
      answers: [
        answer("Q_AUTH_OWNER_STATUS", {
          type: "SINGLE_SELECT",
          optionId: "RUSSIAN_OWNER"
        }),
        answer("Q_AUTH_METHODS", {
          type: "MULTI_SELECT",
          optionIds: ["ESIA", "ALLOWED_RU_METHOD"]
        })
      ],
      expectedStatus: "PASS"
    },
    {
      ruleId: "REC-001",
      facts: [fact("recommendation_technology_suspected"), fact("recommendation_notice_candidate", { found: false })],
      answers: [
        answer("Q_RECOMMENDER_TECH_USE", {
          type: "SINGLE_SELECT",
          optionId: "USES_RECOMMENDER_TECH"
        })
      ],
      expectedStatus: "MANUAL_CHECK",
      expectedReasonCode: "RULE_POLICY_REQUIRES_MANUAL_CHECK"
    },
    {
      ruleId: "REC-002",
      facts: [fact("recommendation_technology_suspected"), fact("recommendation_rules_document_link", { found: false })],
      answers: [
        answer("Q_RECOMMENDER_TECH_USE", {
          type: "SINGLE_SELECT",
          optionId: "USES_RECOMMENDER_TECH"
        })
      ],
      expectedStatus: "MANUAL_CHECK",
      expectedReasonCode: "RULE_POLICY_REQUIRES_MANUAL_CHECK"
    },
    {
      ruleId: "REC-004",
      facts: [
        fact("recommendation_technology_suspected"),
        fact("owner_contact_for_recommender_requirements_missing", { found: false })
      ],
      answers: [
        answer("Q_RECOMMENDER_TECH_USE", {
          type: "SINGLE_SELECT",
          optionId: "USES_RECOMMENDER_TECH"
        })
      ],
      expectedStatus: "MANUAL_CHECK",
      expectedReasonCode: "RULE_POLICY_REQUIRES_MANUAL_CHECK"
    },
    {
      ruleId: "LANG-002",
      siteType: "ECOMMERCE",
      facts: [fact("public_non_ad_consumer_info_foreign_only")],
      answers: [
        answer("Q_LANGUAGE_EXCEPTION", {
          type: "SINGLE_SELECT",
          optionId: "NO_EXCEPTION"
        })
      ],
      expectedStatus: "WARNING"
    }
  ] as const)("executes applicable happy path for $ruleId", (scenario) => {
    const evaluation = evaluationFor(
      evaluateOwnerRules(
        context({
          siteType: scenario.siteType,
          facts: scenario.facts,
          answers: scenario.answers
        })
      ),
      scenario.ruleId
    );

    expect(evaluation.applicability).toBe("REQUIRED");
    expect(evaluation.status).toBe(scenario.expectedStatus);
    expect(evaluation.reasonCode).toBe(scenario.expectedReasonCode);
    expect(evaluation.ownerAnswerRefs.length).toBeGreaterThan(0);
    expect(evaluation.siteEvidenceRefs).toEqual(evaluation.siteFactRefs);
  });

  it.each([
    ["PD-007", [fact("personal_data_collection_found")], "Q_PD_COLLECTION_LEGAL_BASIS", undefined],
    ["PD-012", [fact("marketing_subscription_detected")], "Q_MARKETING_CONSENT_PROOF", undefined],
    ["PD-022", [fact("personal_data_collection_found")], "Q_PD_PRIMARY_DB_LOCATION", undefined],
    ["PD-023", [fact("personal_data_collection_found"), fact("seller_legal_name_candidate")], "Q_PD_OPERATOR_RKN_NOTIFICATION", undefined],
    ["ADV-001", [fact("ad_candidate_detected")], "Q_AD_MATERIAL_QUALIFICATION", undefined],
    ["ADV-002", [fact("ad_candidate_detected")], "Q_AD_MATERIAL_QUALIFICATION", undefined],
    ["ADV-003", [fact("ad_candidate_detected")], "Q_AD_MATERIAL_QUALIFICATION", undefined],
    ["ADV-004", [fact("marketing_subscription_detected")], "Q_MARKETING_CONSENT_PROOF", undefined],
    ["AUTH-001", [fact("auth_ui_static_signal")], "Q_AUTH_OWNER_STATUS", undefined],
    ["REC-001", [fact("recommendation_technology_suspected")], "Q_RECOMMENDER_TECH_USE", undefined],
    ["REC-002", [fact("recommendation_technology_suspected")], "Q_RECOMMENDER_TECH_USE", undefined],
    ["REC-004", [fact("recommendation_technology_suspected")], "Q_RECOMMENDER_TECH_USE", undefined],
    ["LANG-002", [fact("public_non_ad_consumer_info_foreign_only")], "Q_LANGUAGE_EXCEPTION", "ECOMMERCE"]
  ] as const)("keeps unanswered applicable %s unresolved", (ruleId, facts, questionId, siteType) => {
    const evaluation = evaluationFor(evaluateOwnerRules(context({ siteType, facts })), ruleId);

    expect(evaluation.applicability).toBe("REQUIRED");
    expect(evaluation.status).toBe("UNRESOLVED");
    expect(evaluation.reasonCode).toBe("ANSWER_REQUIRED");
    expect(evaluation.questionIds).toContain(questionId);
  });

  it.each([
    ["PD-007", [fact("personal_data_collection_found")], "Q_PD_COLLECTION_LEGAL_BASIS", undefined],
    ["PD-012", [fact("marketing_subscription_detected")], "Q_MARKETING_CONSENT_PROOF", undefined],
    ["PD-022", [fact("personal_data_collection_found")], "Q_PD_PRIMARY_DB_LOCATION", undefined],
    ["PD-023", [fact("personal_data_collection_found"), fact("seller_legal_name_candidate")], "Q_PD_OPERATOR_RKN_NOTIFICATION", undefined],
    ["ADV-001", [fact("ad_candidate_detected")], "Q_AD_MATERIAL_QUALIFICATION", undefined],
    ["ADV-002", [fact("ad_candidate_detected")], "Q_AD_MATERIAL_QUALIFICATION", undefined],
    ["ADV-003", [fact("ad_candidate_detected")], "Q_AD_MATERIAL_QUALIFICATION", undefined],
    ["ADV-004", [fact("marketing_subscription_detected")], "Q_MARKETING_CONSENT_PROOF", undefined],
    ["REC-001", [fact("recommendation_technology_suspected")], "Q_RECOMMENDER_TECH_USE", undefined],
    ["REC-002", [fact("recommendation_technology_suspected")], "Q_RECOMMENDER_TECH_USE", undefined],
    ["REC-004", [fact("recommendation_technology_suspected")], "Q_RECOMMENDER_TECH_USE", undefined],
    ["LANG-002", [fact("public_non_ad_consumer_info_foreign_only")], "Q_LANGUAGE_EXCEPTION", "ECOMMERCE"]
  ] as const)("turns unknown answer for %s into MANUAL_CHECK", (ruleId, facts, questionId, siteType) => {
    const evaluation = evaluationFor(
      evaluateOwnerRules(
        context({
          siteType,
          facts,
          answers: [answer(questionId, { unknown: true })]
        })
      ),
      ruleId
    );

    expect(evaluation.applicability).toBe("REQUIRED");
    expect(evaluation.status).toBe("MANUAL_CHECK");
    expect(evaluation.reasonCode).toBe("OWNER_UNKNOWN");
  });

  it.each([
    ["PD-007", "B2B", [], "NOT_APPLICABLE"],
    ["PD-012", "B2B", [], "NOT_APPLICABLE"],
    ["PD-022", "B2B", [], "NOT_APPLICABLE"],
    ["PD-023", "B2B", [fact("personal_data_collection_found")], "UNRESOLVED"],
    ["ADV-001", "B2B", [], "UNRESOLVED"],
    ["ADV-002", "B2B", [], "UNRESOLVED"],
    ["ADV-003", "B2B", [], "UNRESOLVED"],
    ["ADV-004", "B2B", [], "NOT_APPLICABLE"],
    ["AUTH-001", "B2B", [], "NOT_APPLICABLE"],
    ["REC-001", "B2B", [], "UNRESOLVED"],
    ["REC-002", "B2B", [], "UNRESOLVED"],
    ["REC-004", "B2B", [], "UNRESOLVED"],
    ["LANG-002", "ECOMMERCE", [fact("page_language_signal")], "UNRESOLVED"]
  ] as const)("returns not applicable or unresolved applicability for %s", (ruleId, siteType, facts, expectedStatus) => {
    const evaluation = evaluationFor(evaluateOwnerRules(context({ siteType, facts })), ruleId);

    expect(evaluation.status).toBe(expectedStatus);
    if (expectedStatus === "UNRESOLVED") {
      expect(evaluation.reasonCode).toBe("APPLICABILITY_UNRESOLVED");
    }
  });

  it.each([
    [
      "PD-007",
      [fact("personal_data_collection_found")],
      answer("Q_PD_COLLECTION_LEGAL_BASIS", { type: "SINGLE_SELECT", optionId: "NO_PD_PROCESSING" }),
      undefined
    ],
    [
      "PD-012",
      [fact("marketing_subscription_detected")],
      answer("Q_MARKETING_CONSENT_PROOF", { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }),
      undefined
    ],
    [
      "ADV-001",
      [fact("ad_label_text_found")],
      answer("Q_AD_MATERIAL_QUALIFICATION", { type: "SINGLE_SELECT", optionId: "NOT_AD" }),
      undefined
    ],
    [
      "ADV-002",
      [fact("erid_token_candidate")],
      answer("Q_AD_MATERIAL_QUALIFICATION", { type: "SINGLE_SELECT", optionId: "NOT_AD" }),
      undefined
    ],
    [
      "ADV-003",
      [fact("erid_token_candidate")],
      answer("Q_AD_MATERIAL_QUALIFICATION", { type: "SINGLE_SELECT", optionId: "NOT_AD" }),
      undefined
    ],
    [
      "AUTH-001",
      [fact("auth_ui_static_signal")],
      answer("Q_AUTH_METHODS", { type: "MULTI_SELECT", optionIds: ["NO_AUTH"] }),
      answer("Q_AUTH_OWNER_STATUS", { type: "SINGLE_SELECT", optionId: "RUSSIAN_OWNER" })
    ],
    [
      "REC-001",
      [fact("recommendation_technology_suspected")],
      answer("Q_RECOMMENDER_TECH_USE", { type: "SINGLE_SELECT", optionId: "NO_RECOMMENDER_TECH" }),
      undefined
    ],
    [
      "REC-002",
      [fact("recommendation_technology_suspected")],
      answer("Q_RECOMMENDER_TECH_USE", { type: "SINGLE_SELECT", optionId: "BASIC_SORTING_ONLY" }),
      undefined
    ],
    [
      "REC-004",
      [fact("recommendation_technology_suspected")],
      answer("Q_RECOMMENDER_TECH_USE", { type: "SINGLE_SELECT", optionId: "NO_RECOMMENDER_TECH" }),
      undefined
    ]
  ] as const)("detects supported reality-check conflict for %s", (ruleId, facts, primaryAnswer, prerequisiteAnswer) => {
    const evaluation = evaluationFor(
      evaluateOwnerRules(
        context({
          facts,
          answers: prerequisiteAnswer ? [prerequisiteAnswer, primaryAnswer] : [primaryAnswer]
        })
      ),
      ruleId
    );

    expect(evaluation.status).toBe("MANUAL_CHECK");
    expect(evaluation.reasonCode).toBe("OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE");
    expect(evaluation.conflictDetected).toBe(true);
    expect(evaluation.siteEvidenceRefs.length).toBeGreaterThan(0);
  });

  it("does not conflict PD-022 on foreign provider signal alone", () => {
    const evaluation = evaluationFor(
      evaluateOwnerRules(
        context({
          facts: [fact("personal_data_collection_found"), fact("foreign_provider_signal_found")],
          answers: [
            answer("Q_PD_PRIMARY_DB_LOCATION", {
              type: "SINGLE_SELECT",
              optionId: "RU_FIRST"
            })
          ]
        })
      ),
      "PD-022"
    );

    expect(evaluation.status).toBe("PASS");
    expect(evaluation.conflictDetected).toBe(false);
  });

  it("keeps PD-023 registry-present answer at MANUAL_CHECK until registry integration exists", () => {
    const evaluation = evaluationFor(
      evaluateOwnerRules(
        context({
          facts: [fact("personal_data_collection_found"), fact("seller_legal_name_candidate")],
          answers: [
            answer("Q_PD_OPERATOR_RKN_NOTIFICATION", {
              type: "SINGLE_SELECT",
              optionId: "REGISTRY_PRESENT"
            })
          ]
        })
      ),
      "PD-023"
    );

    expect(evaluation.status).toBe("MANUAL_CHECK");
    expect(evaluation.reasonCode).toBe("RULE_POLICY_REQUIRES_MANUAL_CHECK");
  });

  it("uses one ad qualification answer for ADV-001, ADV-002, and ADV-003", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [
          fact("ad_candidate_detected"),
          fact("ad_label_text_found", { found: false }),
          fact("advertiser_identity_or_link_found", { found: false }),
          fact("erid_token_candidate", { found: false })
        ],
        answers: [
          answer("Q_AD_MATERIAL_QUALIFICATION", {
            type: "SINGLE_SELECT",
            optionId: "IS_INTERNET_AD"
          })
        ]
      })
    );

    for (const ruleId of ["ADV-001", "ADV-002", "ADV-003"]) {
      expect(evaluationFor(result, ruleId).status).toBe("MANUAL_CHECK");
      expect(evaluationFor(result, ruleId).ownerAnswerRefs).toEqual([
        { questionId: "Q_AD_MATERIAL_QUALIFICATION", answerId: "Q_AD_MATERIAL_QUALIFICATION-answer" }
      ]);
    }
  });

  it("uses one recommender answer for REC-001, REC-002, and REC-004", () => {
    const result = evaluateOwnerRules(
      context({
        facts: [
          fact("recommendation_technology_suspected"),
          fact("recommendation_notice_candidate", { found: false }),
          fact("recommendation_rules_document_link", { found: false }),
          fact("owner_contact_for_recommender_requirements_missing", { found: false })
        ],
        answers: [
          answer("Q_RECOMMENDER_TECH_USE", {
            type: "SINGLE_SELECT",
            optionId: "USES_RECOMMENDER_TECH"
          })
        ]
      })
    );

    for (const ruleId of ["REC-001", "REC-002", "REC-004"]) {
      expect(evaluationFor(result, ruleId).status).toBe("MANUAL_CHECK");
      expect(evaluationFor(result, ruleId).ownerAnswerRefs).toEqual([
        { questionId: "Q_RECOMMENDER_TECH_USE", answerId: "Q_RECOMMENDER_TECH_USE-answer" }
      ]);
    }
  });
});
