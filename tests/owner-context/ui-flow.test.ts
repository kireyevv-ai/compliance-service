import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import {
  getOwnerContextForScan,
  saveOwnerAnswerForScan,
  type OwnerContextResponse
} from "@/app/api/owner-context/helpers";
import {
  buildOwnerQuestionSteps,
  nextStepIndexAfterAcknowledgedConflict,
  ownerAnswerValuesEqual,
  OwnerContextFlow,
  resolveStepIndex,
  shouldShowPersistedConflictForStep
} from "@/app/owner-context/components/owner-context-flow";
import type { Queryable } from "@/db/client";
import {
  createFact,
  createQueuedScan,
  createSite,
  getOwnerAnswersForScan,
  upsertOwnerAnswer,
  upsertUser
} from "@/db/repository";
import type { SiteType } from "@/db/schema";

function createTestDb(): Queryable {
  const db = newDb();
  for (const file of ["001_initial_schema.sql", "002_owner_answers.sql", "003_owner_answer_context_key.sql"]) {
    db.public.none(readFileSync(path.join(process.cwd(), "src", "db", "migrations", file), "utf8"));
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function createDbWithMigrations(files: string[]): Queryable {
  const db = newDb();
  for (const file of files) {
    db.public.none(readFileSync(path.join(process.cwd(), "src", "db", "migrations", file), "utf8"));
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

async function ownerAnswersSchemaSignature(db: Queryable) {
  const columns = await db.query<{
    column_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `
      select column_name, is_nullable, column_default
      from information_schema.columns
      where table_name = 'owner_answers'
      order by ordinal_position
    `
  );
  const uniqueConstraints = await db.query<{ constraint_name: string }>(
    `
      select constraint_name
      from information_schema.table_constraints
      where table_name = 'owner_answers'
        and constraint_type = 'UNIQUE'
      order by constraint_name
    `
  );

  return {
    columns: columns.rows,
    uniqueConstraints: uniqueConstraints.rows.map((row) => row.constraint_name)
  };
}

async function createScan(db: Queryable, siteType: SiteType = "B2B") {
  const user = await upsertUser(db, { email: `owner-ui-${crypto.randomUUID()}@example.test` });
  const site = await createSite(db, {
    userId: user.id,
    url: "https://example.test/",
    normalizedDomain: "example.test"
  });
  return createQueuedScan(db, { siteId: site.id, siteType, scannerVersion: "owner-ui-test" });
}

async function addFact(db: Queryable, scanId: string, factType: string, value: Record<string, unknown> = { found: true }) {
  return createFact(db, {
    scanId,
    pageUrl: "https://example.test/",
    factType,
    value
  });
}

async function ownerContext(db: Queryable, scanId: string): Promise<OwnerContextResponse> {
  const result = await getOwnerContextForScan(scanId, { db });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.ownerContext;
}

describe("owner context API contract", () => {
  it("keeps contextual owner answer schema consistent for existing and fresh migration paths", async () => {
    const existingDb = createDbWithMigrations(["001_initial_schema.sql", "002_owner_answers.sql"]);
    const userId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const scanId = crypto.randomUUID();

    await existingDb.query(
      `
        insert into users (id, email, created_at)
        values ($1, 'migration-existing@example.test', now())
      `,
      [userId]
    );
    await existingDb.query(
      `
        insert into sites (id, user_id, url, normalized_domain, created_at)
        values ($1, $2, 'https://example.test/', 'example.test', now())
      `,
      [siteId, userId]
    );
    await existingDb.query(
      `
        insert into scans (id, site_id, status, site_type, scanner_version, created_at)
        values ($1, $2, 'COMPLETED', 'B2B', 'migration-test', now())
      `,
      [scanId, siteId]
    );
    await existingDb.query(
      `
        insert into owner_answers (id, scan_id, question_id, answer_json, provenance, answered_at, updated_at)
        values ($1, $2, 'Q_MARKETING_CONSENT_PROOF', '{"type":"SINGLE_SELECT","optionId":"NO_MARKETING"}', 'OWNER', now(), now())
      `,
      [crypto.randomUUID(), scanId]
    );

    await existingDb.query(readFileSync(path.join(process.cwd(), "src", "db", "migrations", "003_owner_answer_context_key.sql"), "utf8"));

    const freshDb = createDbWithMigrations([
      "001_initial_schema.sql",
      "002_owner_answers.sql",
      "003_owner_answer_context_key.sql"
    ]);

    expect(await ownerAnswersSchemaSignature(existingDb)).toEqual(await ownerAnswersSchemaSignature(freshDb));
    expect(await getOwnerAnswersForScan(existingDb, scanId)).toMatchObject([
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        contextKey: "",
        provenance: "OWNER"
      }
    ]);

    await upsertOwnerAnswer(existingDb, {
      scanId,
      questionId: "Q_MARKETING_CONSENT_PROOF",
      contextKey: "form-a",
      answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
    });
    expect(await getOwnerAnswersForScan(existingDb, scanId)).toHaveLength(2);
  });

  it("returns only REQUIRED questions and hides NOT_NEEDED and UNRESOLVED questions", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found");
    await addFact(db, scan.id, "page_language_signal");

    const context = await ownerContext(db, scan.id);

    expect(context.requiredQuestions.map((question) => question.definition.questionId)).toEqual([
      "Q_PD_COLLECTION_LEGAL_BASIS",
      "Q_PD_PRIMARY_DB_LOCATION"
    ]);
    expect(context.requiredQuestions.map((question) => question.definition.questionId)).not.toContain(
      "Q_MARKETING_CONSENT_PROOF"
    );
    expect(context.requiredQuestions.map((question) => question.definition.questionId)).not.toContain(
      "Q_AD_MATERIAL_QUALIFICATION"
    );
    expect(context.requiredQuestions.map((question) => question.definition.questionId)).not.toContain(
      "Q_LANGUAGE_EXCEPTION"
    );
    expect(context.totalRequired).toBe(2);
    expect(context.answeredCount).toBe(0);
    expect(context.remainingCount).toBe(2);
  });

  it("shows a shared question only once when one answer feeds multiple rules", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected");

    const context = await ownerContext(db, scan.id);

    expect(context.requiredQuestions.map((question) => question.definition.questionId)).toEqual([
      "Q_MARKETING_CONSENT_PROOF"
    ]);
    expect(context.evaluations.filter((evaluation) => evaluation.questionIds.includes("Q_MARKETING_CONSENT_PROOF")).map((evaluation) => evaluation.ruleId)).toEqual([
      "PD-012",
      "ADV-004"
    ]);
  });

  it("restores existing answers in the question response", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found");
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
      contextKey: "/",
      answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
    });

    const context = await ownerContext(db, scan.id);
    const question = context.requiredQuestions.find(
      (item) => item.definition.questionId === "Q_PD_COLLECTION_LEGAL_BASIS"
    );

    expect(question?.answer?.answer).toEqual({ type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" });
    expect(context.answeredCount).toBe(1);
  });

  it("updates an answer and recalculates evaluations", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found");

    const first = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "/",
        answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
      },
      { db }
    );
    const second = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "/",
        answer: { type: "SINGLE_SELECT", optionId: "NO_BASIS" }
      },
      { db }
    );

    expect(first.ok && first.ownerContext.evaluations.find((item) => item.ruleId === "PD-007")?.status).toBe("PASS");
    expect(second.ok && second.ownerContext.evaluations.find((item) => item.ruleId === "PD-007")?.status).toBe("FAIL");
    expect(second.ok && second.ownerContext.answeredCount).toBe(1);
  });

  it("reveals Q_AUTH_METHODS only after Russian owner status is saved", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "auth_ui_static_signal");

    const before = await ownerContext(db, scan.id);
    expect(before.requiredQuestions.map((question) => question.definition.questionId)).toEqual([
      "Q_AUTH_OWNER_STATUS"
    ]);

    const after = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_AUTH_OWNER_STATUS",
        answer: { type: "SINGLE_SELECT", optionId: "RUSSIAN_OWNER" }
      },
      { db }
    );

    expect(after.ok && after.ownerContext.requiredQuestions.map((question) => question.definition.questionId)).toEqual([
      "Q_AUTH_OWNER_STATUS",
      "Q_AUTH_METHODS"
    ]);
  });

  it("saves unknown answers correctly", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected");

    const result = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { unknown: true }
      },
      { db }
    );

    expect(result.ok && result.ownerContext.existingAnswers[0].answer).toEqual({ unknown: true });
    expect(result.ok && result.ownerContext.evaluations.find((item) => item.ruleId === "PD-012")?.status).toBe(
      "MANUAL_CHECK"
    );
  });

  it("rejects invalid options server-side", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected");

    const result = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NOT_A_REAL_OPTION" }
      },
      { db }
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("skips owner flow when no questions are required", async () => {
    const db = createTestDb();
    const scan = await createScan(db);

    const context = await ownerContext(db, scan.id);

    expect(context.totalRequired).toBe(0);
    expect(context.shouldSkipOwnerFlow).toBe(true);
  });

  it("renders conflicts as a neutral warning without technical reason codes", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, {
        initialContext: saved.ownerContext,
        initialStepKey: "marketing-consent"
      })
    );

    expect(html).toContain("Нужно уточнение");
    expect(html).toContain("Ваш ответ не совпадает с тем, что мы обнаружили на сайте");
    expect(html).toContain("Мы не считаем это нарушением автоматически");
    expect(html).not.toContain("OWNER_ANSWER_CONFLICTS_WITH_SITE_EVIDENCE");
    expect(html).not.toContain("PD-012");
    expect(html).not.toContain("marketing_subscription_detected");
  });

  it("renders marketing conflict warning only for a conflicting saved answer", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });

    const conflicting = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!conflicting.ok) {
      throw new Error(conflicting.error);
    }

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, {
        initialContext: conflicting.ownerContext,
        initialStepKey: "marketing-consent"
      })
    );

    expect(conflicting.ownerContext.conflicts).toHaveLength(2);
    expect(html).toContain("Нужно уточнение");
    expect(html).toContain("Ваш ответ не совпадает с тем, что мы обнаружили на сайте");
    expect(html).toContain("Изменить ответ");
    expect(html).toContain("Оставить ответ и продолжить");
  });

  it("hides a saved conflict immediately when the current selection changes", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const step = buildOwnerQuestionSteps(saved.ownerContext.requiredQuestions).find(
      (item) => item.key === "marketing-consent"
    )!;

    expect(
      shouldShowPersistedConflictForStep(step, saved.ownerContext, {
        "Q_MARKETING_CONSENT_PROOF::": { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      })
    ).toBe(true);
    expect(
      shouldShowPersistedConflictForStep(step, saved.ownerContext, {
        "Q_MARKETING_CONSENT_PROOF::": { type: "SINGLE_SELECT", optionId: "PROOF_STORED" }
      })
    ).toBe(false);
  });

  it("shows a saved conflict again when selection is reverted before saving", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const step = buildOwnerQuestionSteps(saved.ownerContext.requiredQuestions).find(
      (item) => item.key === "marketing-consent"
    )!;

    const changedDraft = {
      "Q_MARKETING_CONSENT_PROOF::": { type: "SINGLE_SELECT" as const, optionId: "PROOF_STORED" }
    };
    const revertedDraft = {
      "Q_MARKETING_CONSENT_PROOF::": { type: "SINGLE_SELECT" as const, optionId: "NO_MARKETING" }
    };

    expect(shouldShowPersistedConflictForStep(step, saved.ownerContext, changedDraft)).toBe(false);
    expect(shouldShowPersistedConflictForStep(step, saved.ownerContext, revertedDraft)).toBe(true);
  });

  it("does not render marketing conflict warning for proof, weak proof, or unknown answers", async () => {
    for (const answer of [
      { type: "SINGLE_SELECT" as const, optionId: "PROOF_STORED" },
      { type: "SINGLE_SELECT" as const, optionId: "WEAK_PROOF" },
      { unknown: true as const }
    ]) {
      const db = createTestDb();
      const scan = await createScan(db);
      await addFact(db, scan.id, "marketing_subscription_detected", {
        found: true,
        text: "Подписаться на акции и предложения"
      });
      const saved = await saveOwnerAnswerForScan(
        scan.id,
        {
          questionId: "Q_MARKETING_CONSENT_PROOF",
          answer
        },
        { db }
      );

      if (!saved.ok) {
        throw new Error(saved.error);
      }

      const html = renderToStaticMarkup(
        createElement(OwnerContextFlow, {
          initialContext: saved.ownerContext,
          initialStepKey: "marketing-consent"
        })
      );

      expect(saved.ownerContext.conflicts).toHaveLength(0);
      expect(html).not.toContain("Нужно уточнение");
      expect(html).not.toContain("Ваш ответ не совпадает с тем, что мы обнаружили на сайте");
    }
  });

  it("removes a marketing conflict after changing to a non-conflicting saved answer", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const conflicting = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );
    const resolved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "PROOF_STORED" }
      },
      { db }
    );

    if (!conflicting.ok || !resolved.ok) {
      throw new Error("Could not save marketing answers");
    }

    expect(conflicting.ownerContext.conflicts).toHaveLength(2);
    expect(resolved.ownerContext.conflicts).toHaveLength(0);

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, {
        initialContext: resolved.ownerContext,
        initialStepKey: "marketing-consent"
      })
    );

    expect(html).not.toContain("Нужно уточнение");
  });

  it("uses normal continue button for a non-conflicting saved answer", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "PROOF_STORED" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, {
        initialContext: saved.ownerContext,
        initialStepKey: "marketing-consent"
      })
    );

    expect(html).toContain("Продолжить");
    expect(html).not.toContain("Оставить ответ и продолжить");
  });

  it("advances to the next step after acknowledging a conflicting answer", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      fields: ["name"]
    });
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const steps = buildOwnerQuestionSteps(saved.ownerContext.requiredQuestions);
    const currentIndex = steps.findIndex((step) => step.key === "marketing-consent");
    const nextIndex = nextStepIndexAfterAcknowledgedConflict(steps, currentIndex);

    expect(saved.ownerContext.conflicts).toHaveLength(2);
    expect(nextIndex).toBe(currentIndex + 1);
    expect(steps[nextIndex].key).toBe("data-storage");
  });

  it("shows completion after acknowledging a conflict on the last step", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const steps = buildOwnerQuestionSteps(saved.ownerContext.requiredQuestions);

    expect(steps).toHaveLength(1);
    expect(nextStepIndexAfterAcknowledgedConflict(steps, 0)).toBe(1);
    expect(saved.ownerContext.conflicts).toHaveLength(2);
  });

  it("keeps the user on the same question when choosing to edit a conflicting answer", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, {
        initialContext: saved.ownerContext,
        initialStepKey: "marketing-consent"
      })
    );

    expect(html).toContain("Вопрос 1 из 1");
    expect(html).toContain("Изменить ответ");
    expect(html).toContain(
      "Если вы отправляете рекламные сообщения или рассылки, можете ли вы подтвердить, что пользователь заранее согласился их получать?"
    );
  });

  it("acknowledging a conflict repeatedly cannot keep returning to the same step", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      fields: ["name"]
    });
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const steps = buildOwnerQuestionSteps(saved.ownerContext.requiredQuestions);
    const marketingIndex = steps.findIndex((step) => step.key === "marketing-consent");
    const firstAdvance = nextStepIndexAfterAcknowledgedConflict(steps, marketingIndex);
    const secondAdvance = nextStepIndexAfterAcknowledgedConflict(steps, firstAdvance);

    expect(firstAdvance).toBeGreaterThan(marketingIndex);
    expect(secondAdvance).toBeGreaterThan(firstAdvance);
  });

  it("keeps conflict visibility tied to persisted answers instead of client-side option rules", async () => {
    expect(
      ownerAnswerValuesEqual(
        { type: "SINGLE_SELECT", optionId: "ANY_SAVED_OPTION" },
        { type: "SINGLE_SELECT", optionId: "ANY_SAVED_OPTION" }
      )
    ).toBe(true);
    expect(
      ownerAnswerValuesEqual(
        { type: "SINGLE_SELECT", optionId: "ANY_NEW_OPTION" },
        { type: "SINGLE_SELECT", optionId: "ANY_SAVED_OPTION" }
      )
    ).toBe(false);
    expect(
      ownerAnswerValuesEqual(
        { type: "MULTI_SELECT", optionIds: ["B", "A"] },
        { type: "MULTI_SELECT", optionIds: ["A", "B"] }
      )
    ).toBe(true);
  });

  it("does not render conflict from another question on the current step", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      fields: ["name"]
    });
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const formStepKey = buildOwnerQuestionSteps(saved.ownerContext.requiredQuestions).find((step) =>
      step.questions.some((question) => question.questionId === "Q_PD_COLLECTION_LEGAL_BASIS")
    )?.key;
    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, {
        initialContext: saved.ownerContext,
        initialStepKey: formStepKey
      })
    );

    expect(saved.ownerContext.conflicts).toHaveLength(2);
    expect(html).toContain("На каком основании вы получаете и используете данные из этой формы?");
    expect(html).not.toContain("Нужно уточнение");
  });

  it("places the conflict warning inside the current question card after answer options", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected", {
      found: true,
      text: "Подписаться на акции и предложения"
    });
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "NO_MARKETING" }
      },
      { db }
    );

    if (!saved.ok) {
      throw new Error(saved.error);
    }

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, {
        initialContext: saved.ownerContext,
        initialStepKey: "marketing-consent"
      })
    );
    const questionCardStart = html.indexOf('class="owner-question-card"');
    const optionsStart = html.indexOf('class="owner-options"');
    const warningStart = html.indexOf('class="owner-conflict"');
    const questionCardEnd = html.indexOf("</article>", questionCardStart);
    const actionsStart = html.indexOf('class="owner-actions"');

    expect(questionCardStart).toBeGreaterThan(-1);
    expect(optionsStart).toBeGreaterThan(questionCardStart);
    expect(warningStart).toBeGreaterThan(optionsStart);
    expect(warningStart).toBeLessThan(questionCardEnd);
    expect(warningStart).toBeLessThan(actionsStart);
  });

  it("renders natural intro copy and compact question progress without remaining counter", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found");
    await addFact(db, scan.id, "marketing_subscription_detected");
    const context = await ownerContext(db, scan.id);

    const html = renderToStaticMarkup(createElement(OwnerContextFlow, { initialContext: context }));

    expect(html).toContain("Чтобы завершить проверку, ответьте на несколько уточняющих вопросов.");
    expect(html).toContain("Вопрос 1 из 3");
    expect(html).not.toContain("3 вопросов");
    expect(html).not.toContain("осталось");
    expect(html).not.toContain("0 осталось");
  });

  it("groups two personal-data form instances into one visible step", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-consultation",
      formLabel: "Заказать консультацию",
      pageTitle: "Контакты",
      fields: ["name", "phone", "email"]
    });
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-callback",
      pageTitle: "Поддержка",
      fields: ["name", "phone"]
    });
    await addFact(db, scan.id, "marketing_subscription_detected");
    const context = await ownerContext(db, scan.id);

    const steps = buildOwnerQuestionSteps(context.requiredQuestions);
    const html = renderToStaticMarkup(createElement(OwnerContextFlow, { initialContext: context }));

    expect(context.requiredQuestions).toHaveLength(4);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ kind: "personal-data-forms" });
    expect(steps[0].questions).toHaveLength(2);
    expect(html).toContain("Вопрос 1 из 3");
    expect(html).toContain("Основания обработки данных");
    expect(html).toContain(
      "На сайте обнаружено несколько форм, которые собирают персональные данные. Укажите основание обработки для каждой из них."
    );
    expect(html).toContain("Форма «Заказать консультацию»");
    expect(html).toContain("Форма на странице «Поддержка»");
    expect(html).toContain("Собирает: имя, телефон, электронная почта");
    expect(html).not.toContain("Вопрос 2 из 4");
  });

  it("keeps a single personal-data form as one ordinary step", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-consultation",
      formLabel: "Заказать консультацию",
      fields: ["name", "phone"]
    });
    const context = await ownerContext(db, scan.id);

    const steps = buildOwnerQuestionSteps(context.requiredQuestions);
    const html = renderToStaticMarkup(createElement(OwnerContextFlow, { initialContext: context }));

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ kind: "single" });
    expect(html).toContain("Вопрос 1 из 2");
    expect(html).toContain("На каком основании вы получаете и используете данные из этой формы?");
    expect(html).not.toContain("Основания обработки данных");
  });

  it("creates two independent instances for two different personal-data forms", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-consultation",
      formLabel: "Заказать консультацию",
      fields: ["name", "phone", "email"]
    });
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-callback",
      pageTitle: "Контакты",
      fields: ["name", "phone"]
    });

    const context = await ownerContext(db, scan.id);
    const pdQuestions = context.requiredQuestions.filter(
      (question) => question.questionId === "Q_PD_COLLECTION_LEGAL_BASIS"
    );

    expect(pdQuestions).toHaveLength(2);
    expect(pdQuestions.map((question) => question.contextKey)).toEqual(["form-consultation", "form-callback"]);
    expect(pdQuestions[0].contextSummary).toMatchObject({
      title: "Форма «Заказать консультацию»",
      page: "/",
      fields: ["имя", "телефон", "электронная почта"]
    });
    expect(pdQuestions[1].contextSummary).toMatchObject({
      title: "Форма на странице «Контакты»",
      fields: ["имя", "телефон"]
    });
  });

  it("stores answers separately for different form instances", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      fields: ["name"]
    });
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-b",
      fields: ["phone"]
    });

    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-a",
        answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
      },
      { db }
    );
    const saved = await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-b",
        answer: { type: "SINGLE_SELECT", optionId: "SEPARATE_CONSENT" }
      },
      { db }
    );

    expect(saved.ok && saved.ownerContext.existingAnswers).toHaveLength(2);
    expect(saved.ok && saved.ownerContext.existingAnswers.map((answer) => answer.contextKey).sort()).toEqual([
      "form-a",
      "form-b"
    ]);
  });

  it("updates one form answer without changing another form answer", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      fields: ["name"]
    });
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-b",
      fields: ["phone"]
    });

    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-a",
        answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
      },
      { db }
    );
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-b",
        answer: { type: "SINGLE_SELECT", optionId: "SEPARATE_CONSENT" }
      },
      { db }
    );
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-a",
        answer: { type: "SINGLE_SELECT", optionId: "NO_BASIS" }
      },
      { db }
    );

    const answers = await getOwnerAnswersForScan(db, scan.id);

    expect(answers.find((answer) => answer.contextKey === "form-a")?.answer).toEqual({
      type: "SINGLE_SELECT",
      optionId: "NO_BASIS"
    });
    expect(answers.find((answer) => answer.contextKey === "form-b")?.answer).toEqual({
      type: "SINGLE_SELECT",
      optionId: "SEPARATE_CONSENT"
    });
  });

  it("keeps the first grouped step after reload and restores both form answers", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      formLabel: "Форма A",
      fields: ["name"]
    });
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-b",
      formLabel: "Форма B",
      fields: ["phone"]
    });
    await addFact(db, scan.id, "marketing_subscription_detected");
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-a",
        answer: { type: "SINGLE_SELECT", optionId: "CONTRACT_OR_REQUEST" }
      },
      { db }
    );
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-b",
        answer: { type: "SINGLE_SELECT", optionId: "SEPARATE_CONSENT" }
      },
      { db }
    );
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "PROOF_STORED" }
      },
      { db }
    );
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_PRIMARY_DB_LOCATION",
        answer: { type: "SINGLE_SELECT", optionId: "RU_FIRST" }
      },
      { db }
    );

    const context = await ownerContext(db, scan.id);
    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, { initialContext: context, initialStepKey: "personal-data-forms" })
    );

    expect(context.remainingCount).toBe(0);
    expect(html).toContain("Вопрос 1 из 3");
    expect(html).toContain("Основания обработки данных");
    expect(html).toContain("Форма «Форма A»");
    expect(html).toContain("Форма «Форма B»");
    expect(html).toContain("Выбрано: Данные нужны, чтобы выполнить заявку, заказ или договор");
    expect(html).toContain("Выбрано: Пользователь отдельно соглашается на обработку данных");
    expect(html).not.toContain("Уточнения сохранены");
  });

  it("keeps the middle step after reload when its step key is present", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      fields: ["name"]
    });
    await addFact(db, scan.id, "marketing_subscription_detected");
    const context = await ownerContext(db, scan.id);

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, { initialContext: context, initialStepKey: "marketing-consent" })
    );

    expect(html).toContain("Вопрос 2 из 3");
    expect(html).toContain(
      "Если вы отправляете рекламные сообщения или рассылки, можете ли вы подтвердить, что пользователь заранее согласился их получать?"
    );
    expect(html).not.toContain("Уточнения сохранены");
  });

  it("keeps the previous step after back and reload", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      formLabel: "Форма A",
      fields: ["name"]
    });
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-b",
      formLabel: "Форма B",
      fields: ["phone"]
    });
    await addFact(db, scan.id, "marketing_subscription_detected");
    const context = await ownerContext(db, scan.id);

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, { initialContext: context, initialStepKey: "personal-data-forms" })
    );

    expect(html).toContain("Вопрос 1 из 3");
    expect(html).toContain("Основания обработки данных");
    expect(html).not.toContain("Вопрос 2 из 3");
  });

  it("shows completion only for explicit completion state after the last step", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "marketing_subscription_detected");
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_MARKETING_CONSENT_PROOF",
        answer: { type: "SINGLE_SELECT", optionId: "PROOF_STORED" }
      },
      { db }
    );
    const context = await ownerContext(db, scan.id);

    const html = renderToStaticMarkup(createElement(OwnerContextFlow, { initialContext: context, initialDone: true }));

    expect(context.remainingCount).toBe(0);
    expect(html).toContain("Уточнения сохранены");
    expect(html).toContain("Теперь у нас достаточно данных, чтобы завершить проверку.");
  });

  it("safely recalculates position when a conditional step disappears", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "auth_ui_static_signal");
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_AUTH_OWNER_STATUS",
        answer: { type: "SINGLE_SELECT", optionId: "NOT_RUSSIAN_OWNER" }
      },
      { db }
    );
    const context = await ownerContext(db, scan.id);
    const steps = buildOwnerQuestionSteps(context.requiredQuestions);

    const html = renderToStaticMarkup(
      createElement(OwnerContextFlow, { initialContext: context, initialStepKey: "sign-in-methods" })
    );

    expect(resolveStepIndex(steps, "sign-in-methods")).toBe(0);
    expect(html).toContain("Вопрос 1 из 1");
    expect(html).toContain("Владелец сайта");
    expect(html).not.toContain("Какие способы входа доступны пользователям из России?");
    expect(html).not.toContain("Уточнения сохранены");
  });

  it("does not duplicate the same form instance", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-duplicate",
      fields: ["name"]
    });
    await addFact(db, scan.id, "rendered_personal_data_collection_found", {
      found: true,
      contextKey: "form-duplicate",
      fields: ["name"]
    });

    const context = await ownerContext(db, scan.id);

    expect(
      context.requiredQuestions.filter((question) => question.questionId === "Q_PD_COLLECTION_LEGAL_BASIS")
    ).toHaveLength(1);
  });

  it("renders form context in UI without raw ids or technical names", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-consultation",
      formLabel: "Заказать консультацию",
      fields: ["name", "phone", "email"]
    });
    const context = await ownerContext(db, scan.id);

    const html = renderToStaticMarkup(createElement(OwnerContextFlow, { initialContext: context }));

    expect(html).toContain("Форма «Заказать консультацию»");
    expect(html).toContain("Собирает: имя, телефон, электронная почта");
    expect(html).toContain("На каком основании вы получаете и используете данные из этой формы?");
    expect(html).not.toContain("form-consultation");
    expect(html).not.toContain("personal_data_collection_found");
  });

  it("restores the correct answer for the correct form instance after reload", async () => {
    const db = createTestDb();
    const scan = await createScan(db);
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-a",
      formLabel: "Форма A",
      fields: ["name"]
    });
    await addFact(db, scan.id, "personal_data_collection_found", {
      found: true,
      contextKey: "form-b",
      formLabel: "Форма B",
      fields: ["phone"]
    });
    await saveOwnerAnswerForScan(
      scan.id,
      {
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: "form-b",
        answer: { type: "SINGLE_SELECT", optionId: "SEPARATE_CONSENT" }
      },
      { db }
    );

    const context = await ownerContext(db, scan.id);
    const formA = context.requiredQuestions.find((question) => question.contextKey === "form-a");
    const formB = context.requiredQuestions.find((question) => question.contextKey === "form-b");

    expect(formA?.answer).toBeUndefined();
    expect(formB?.answer?.answer).toEqual({ type: "SINGLE_SELECT", optionId: "SEPARATE_CONSENT" });
  });
});
