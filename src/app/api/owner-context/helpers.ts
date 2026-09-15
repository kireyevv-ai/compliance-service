import { z } from "zod";
import { getPool, type Queryable } from "@/db/client";
import {
  getFactsForScan,
  getOwnerAnswersForScan,
  getScanById,
  upsertOwnerAnswer
} from "@/db/repository";
import { persistOwnerFindingsForScan } from "@/findings/integration";
import {
  evaluateOwnerRules,
  getOwnerQuestionApplicability
} from "@/owner-context/engine";
import { getRequiredOwnerQuestionInstances } from "@/owner-context/instances";
import type {
  OwnerAnswer,
  OwnerAnswerValue,
  OwnerQuestionContextSummary,
  OwnerQuestionDefinition,
  OwnerRuleEvaluation
} from "@/owner-context/types";

const answerSchema: z.ZodType<OwnerAnswerValue> = z.union([
  z.object({ type: z.literal("YES_NO"), value: z.boolean() }),
  z.object({ type: z.literal("SINGLE_SELECT"), optionId: z.string().min(1) }),
  z.object({ type: z.literal("MULTI_SELECT"), optionIds: z.array(z.string().min(1)).min(1) }),
  z.object({ unknown: z.literal(true) }).strict()
]);

const saveAnswerSchema = z.object({
  questionId: z.string().min(1),
  contextKey: z.string().optional(),
  answer: answerSchema
});

export interface OwnerQuestionView {
  questionId: string;
  contextKey: string;
  contextSummary?: OwnerQuestionContextSummary;
  definition: OwnerQuestionDefinition;
  answer?: OwnerAnswer;
}

export interface OwnerContextResponse {
  scanId: string;
  requiredQuestions: OwnerQuestionView[];
  existingAnswers: OwnerAnswer[];
  totalRequired: number;
  answeredCount: number;
  remainingCount: number;
  evaluations: OwnerRuleEvaluation[];
  conflicts: OwnerRuleEvaluation[];
  shouldSkipOwnerFlow: boolean;
}

export async function getOwnerContextForScan(scanId: string, options: { db?: Queryable } = {}) {
  if (!z.string().uuid().safeParse(scanId).success) {
    return { ok: false as const, status: 400, error: "Некорректный идентификатор проверки" };
  }

  const db = options.db ?? getPool();
  const scan = await getScanById(db, scanId);
  if (!scan) {
    return { ok: false as const, status: 404, error: "Проверка не найдена" };
  }

  const facts = await getFactsForScan(db, scan.id);
  const answers = await getOwnerAnswersForScan(db, scan.id);
  const context = { siteType: scan.siteType, facts, answers };
  const evaluations = evaluateOwnerRules(context);
  const requiredQuestions = getRequiredOwnerQuestionInstances(context);
  const answeredCount = requiredQuestions.filter((question) => question.answer).length;

  return {
    ok: true as const,
    status: 200,
    ownerContext: {
      scanId: scan.id,
      requiredQuestions,
      existingAnswers: answers,
      totalRequired: requiredQuestions.length,
      answeredCount,
      remainingCount: requiredQuestions.length - answeredCount,
      evaluations,
      conflicts: evaluations.filter((evaluation) => evaluation.conflictDetected),
      shouldSkipOwnerFlow: requiredQuestions.length === 0
    } satisfies OwnerContextResponse
  };
}

export async function saveOwnerAnswerForScan(
  scanId: string,
  input: unknown,
  options: { db?: Queryable } = {}
) {
  if (!z.string().uuid().safeParse(scanId).success) {
    return { ok: false as const, status: 400, error: "Некорректный идентификатор проверки" };
  }

  const parsed = saveAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, status: 400, error: "Проверьте ответ" };
  }

  const db = options.db ?? getPool();
  const scan = await getScanById(db, scanId);
  if (!scan) {
    return { ok: false as const, status: 404, error: "Проверка не найдена" };
  }

  const facts = await getFactsForScan(db, scan.id);
  const answers = await getOwnerAnswersForScan(db, scan.id);
  const contextKey = parsed.data.contextKey ?? "";
  const applicability = getOwnerQuestionApplicability(parsed.data.questionId, {
    siteType: scan.siteType,
    facts,
    answers
  });

  if (applicability !== "REQUIRED") {
    return { ok: false as const, status: 409, error: "Этот вопрос сейчас не требуется" };
  }

  const requiredInstances = getRequiredOwnerQuestionInstances({ siteType: scan.siteType, facts, answers });
  if (
    !requiredInstances.some(
      (instance) => instance.questionId === parsed.data.questionId && instance.contextKey === contextKey
    )
  ) {
    return { ok: false as const, status: 409, error: "Этот вопрос сейчас не требуется" };
  }

  try {
    await upsertOwnerAnswer(db, {
      scanId: scan.id,
      questionId: parsed.data.questionId,
      contextKey,
      answer: parsed.data.answer
    });
    await persistOwnerFindingsForScan(db, scan);
  } catch {
    return { ok: false as const, status: 400, error: "Проверьте вариант ответа" };
  }

  return getOwnerContextForScan(scan.id, { db });
}
