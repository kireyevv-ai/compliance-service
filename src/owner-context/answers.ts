import { OWNER_QUESTION_BY_ID } from "./questions";
import type { OwnerAnswerValue, OwnerQuestionDefinition } from "./types";

export function validateOwnerAnswer(questionId: string, answer: OwnerAnswerValue): void {
  const question = OWNER_QUESTION_BY_ID.get(questionId);
  if (!question) {
    throw new Error(`Unknown owner question: ${questionId}`);
  }

  if ("unknown" in answer) {
    if (!question.allowUnknown) {
      throw new Error(`Question ${questionId} does not allow unknown answers`);
    }
    if (answer.unknown !== true || Object.keys(answer).length !== 1) {
      throw new Error(`Unknown answer for question ${questionId} must be exclusive`);
    }
    return;
  }

  if (answer.type !== question.answerType) {
    throw new Error(`Question ${questionId} expects ${question.answerType}, received ${answer.type}`);
  }

  if (answer.type === "YES_NO") {
    return;
  }

  if (answer.type === "SINGLE_SELECT") {
    assertKnownOption(question, answer.optionId);
    return;
  }

  if (answer.optionIds.length === 0) {
    throw new Error(`Question ${questionId} requires at least one selected option`);
  }

  for (const optionId of answer.optionIds) {
    assertKnownOption(question, optionId);
  }

  const selected = new Set(answer.optionIds);
  for (const exclusiveOptionId of question.exclusiveOptionIds ?? []) {
    if (selected.has(exclusiveOptionId) && selected.size > 1) {
      throw new Error(`Exclusive option ${exclusiveOptionId} cannot be combined for question ${questionId}`);
    }
  }
}

function assertKnownOption(question: OwnerQuestionDefinition, optionId: string): void {
  if (!question.options.some((option) => option.optionId === optionId)) {
    throw new Error(`Invalid option ${optionId} for question ${question.questionId}`);
  }
}
