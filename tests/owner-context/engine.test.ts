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
  facts?: Fact[];
  answers?: OwnerAnswer[];
} = {}): OwnerContextInput {
  return {
    siteType: input.siteType ?? "B2B",
    facts: input.facts ?? [],
    answers: input.answers ?? []
  };
}

function statusFor(result: ReturnType<typeof evaluateOwnerRules>, ruleId: string) {
  return result.find((item) => item.ruleId === ruleId)?.status;
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
});
