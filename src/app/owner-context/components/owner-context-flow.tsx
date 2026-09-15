"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { OwnerContextResponse, OwnerQuestionView } from "@/app/api/owner-context/helpers";
import type { OwnerAnswerValue, OwnerQuestionDefinition } from "@/owner-context/types";

type SaveState = "idle" | "saving" | "error";
export type DraftAnswers = Record<string, OwnerAnswerValue | undefined>;

export type OwnerQuestionStep =
  | {
      kind: "single";
      key: string;
      questions: [OwnerQuestionView];
    }
  | {
      kind: "personal-data-forms";
      key: string;
      questions: OwnerQuestionView[];
    };

export function OwnerContextFlow({
  initialContext,
  initialDone = false,
  initialStepKey
}: {
  initialContext: OwnerContextResponse;
  initialDone?: boolean;
  initialStepKey?: string;
}) {
  const [ownerContext, setOwnerContext] = useState(initialContext);
  const initialSteps = buildOwnerQuestionSteps(initialContext.requiredQuestions);
  const [currentIndex, setCurrentIndex] = useState(resolveStepIndex(initialSteps, initialStepKey));
  const [draftAnswers, setDraftAnswers] = useState<DraftAnswers>(() => initialDraftAnswers(initialContext));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [showDone, setShowDone] = useState(
    initialDone || (!initialStepKey && initialContext.remainingCount === 0)
  );

  const steps = useMemo(() => buildOwnerQuestionSteps(ownerContext.requiredQuestions), [ownerContext.requiredQuestions]);
  const currentStep = steps[currentIndex];
  const progressIndex = Math.min(currentIndex + 1, steps.length);
  const currentStepConflictVisible = currentStep
    ? shouldShowPersistedConflictForStep(currentStep, ownerContext, draftAnswers)
    : false;

  useEffect(() => {
    if (showDone || !currentStep) {
      return;
    }
    replaceWizardLocation(ownerContext.scanId, currentStep.key);
  }, [currentStep, ownerContext.scanId, showDone]);

  if (showDone || !currentStep) {
    return (
      <section className="panel owner-card">
        <p className="eyebrow">Уточнения сохранены</p>
        <h1>Теперь у нас достаточно данных, чтобы завершить проверку.</h1>
        <div className="owner-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setShowDone(false);
              setCurrentIndex(0);
              setDraftAnswers(initialDraftAnswers(ownerContext));
              if (steps[0]) {
                replaceWizardLocation(ownerContext.scanId, steps[0].key);
              }
            }}
          >
            Изменить ответы
          </button>
          <Link className="primary-button" href={`/results/${ownerContext.scanId}`}>
            Перейти к результатам
          </Link>
        </div>
      </section>
    );
  }

  async function saveAndContinue() {
    if (!currentStep) {
      return;
    }

    const missingAnswers = currentStep.questions.filter((question) => !draftAnswers[questionKey(question)]);
    if (missingAnswers.length > 0) {
      setError(
        currentStep.kind === "personal-data-forms"
          ? "Выберите ответ для каждой формы или отметьте, что пока не знаете."
          : "Выберите ответ или отметьте, что пока не знаете."
      );
      return;
    }

    setSaveState("saving");
    setError(undefined);

    let nextContext: OwnerContextResponse | undefined;

    for (const question of currentStep.questions) {
      const response = await fetch(`/api/scans/${ownerContext.scanId}/owner-context`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionId: question.definition.questionId,
          contextKey: question.contextKey,
          answer: draftAnswers[questionKey(question)]
        })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload) {
        setSaveState("error");
        setError(payload?.error ?? "Не удалось сохранить ответ.");
        return;
      }

      nextContext = payload as OwnerContextResponse;
    }

    if (!nextContext) {
      setSaveState("error");
      setError("Не удалось сохранить ответ.");
      return;
    }

    const currentStepKey = currentStep.key;
    const nextSteps = buildOwnerQuestionSteps(nextContext.requiredQuestions);
    const savedStepIndex = nextSteps.findIndex((step) => step.key === currentStepKey);
    const savedStep = savedStepIndex === -1 ? undefined : nextSteps[savedStepIndex];
    const savedStepHasConflict = savedStep ? hasConflictForStep(savedStep, nextContext) : false;
    const nextIndex = savedStepHasConflict ? savedStepIndex : nextStepIndex(nextSteps, currentIndex);
    setOwnerContext(nextContext);
    setCurrentIndex(nextIndex);
    setDraftAnswers(initialDraftAnswers(nextContext, draftAnswers));
    if (savedStepHasConflict) {
      setShowDone(false);
      replaceWizardLocation(ownerContext.scanId, nextSteps[nextIndex].key);
    } else if (nextIndex >= nextSteps.length) {
      setShowDone(true);
      replaceWizardLocation(ownerContext.scanId, undefined, true);
    } else {
      setShowDone(false);
      replaceWizardLocation(ownerContext.scanId, nextSteps[nextIndex].key);
    }
    setSaveState("idle");
  }

  function goBack() {
    const nextIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(nextIndex);
    setShowDone(false);
    setError(undefined);
    if (steps[nextIndex]) {
      replaceWizardLocation(ownerContext.scanId, steps[nextIndex].key);
    }
  }

  function keepEditingConflictAnswer() {
    setError(undefined);
  }

  function acknowledgeConflictAndContinue() {
    const nextIndex = nextStepIndexAfterAcknowledgedConflict(steps, currentIndex);
    setError(undefined);
    if (nextIndex >= steps.length) {
      setShowDone(true);
      replaceWizardLocation(ownerContext.scanId, undefined, true);
      return;
    }

    setCurrentIndex(nextIndex);
    setShowDone(false);
    replaceWizardLocation(ownerContext.scanId, steps[nextIndex].key);
  }

  function updateDraft(question: OwnerQuestionView, answer: OwnerAnswerValue) {
    setDraftAnswers((current) => ({ ...current, [questionKey(question)]: answer }));
  }

  return (
    <section className="panel owner-card">
      <div className="owner-intro">
        <p className="eyebrow">Уточнение данных</p>
        <h1>Мы проверили всё, что можно определить по сайту.</h1>
        <p>Чтобы завершить проверку, ответьте на несколько уточняющих вопросов.</p>
      </div>

      <article className="owner-question-card">
        <div className="owner-progress">
          <span>Вопрос {progressIndex} из {steps.length}</span>
        </div>
        <OwnerStepBody step={currentStep} draftAnswers={draftAnswers} onChange={updateDraft} />
        {currentStepConflictVisible ? <NeutralConflictNotice /> : null}
      </article>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="owner-actions">
        {currentStepConflictVisible ? (
          <>
            <button className="secondary-button" type="button" onClick={keepEditingConflictAnswer}>
              Изменить ответ
            </button>
            <button className="primary-button" type="button" onClick={acknowledgeConflictAndContinue}>
              Оставить ответ и продолжить
            </button>
          </>
        ) : (
          <>
            <button className="secondary-button" type="button" onClick={goBack} disabled={currentIndex === 0}>
              Назад
            </button>
            <button className="primary-button" type="button" onClick={saveAndContinue} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Сохраняем..." : "Продолжить"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function OwnerStepBody({
  step,
  draftAnswers,
  onChange
}: {
  step: OwnerQuestionStep;
  draftAnswers: DraftAnswers;
  onChange: (question: OwnerQuestionView, answer: OwnerAnswerValue) => void;
}) {
  if (step.kind === "personal-data-forms") {
    return (
      <>
        <div>
          <h2>Основания обработки данных</h2>
          <p className="owner-explanation">
            На сайте обнаружено несколько форм, которые собирают персональные данные. Укажите основание обработки для каждой из них.
          </p>
        </div>
        <div className="owner-form-group">
          {step.questions.map((question, index) => (
            <PersonalDataFormAnswer
              answer={draftAnswers[questionKey(question)]}
              answerName={`answer-${index + 1}`}
              key={questionKey(question)}
              question={question}
              onChange={(answer) => onChange(question, answer)}
            />
          ))}
        </div>
      </>
    );
  }

  const question = step.questions[0];

  return (
    <>
      <h2>{question.definition.text}</h2>
      {question.contextSummary ? <QuestionContext summary={question.contextSummary} /> : null}
      <p className="owner-explanation">
        <strong>Почему мы спрашиваем:</strong> {question.definition.explanation}
      </p>
      <OwnerAnswerControl
        answer={draftAnswers[questionKey(question)]}
        name="answer"
        question={question.definition}
        onChange={(answer) => onChange(question, answer)}
      />
      <SelectedAnswerLabel answer={draftAnswers[questionKey(question)]} question={question.definition} />
    </>
  );
}

function PersonalDataFormAnswer({
  answer,
  answerName,
  question,
  onChange
}: {
  answer?: OwnerAnswerValue;
  answerName: string;
  question: OwnerQuestionView;
  onChange: (answer: OwnerAnswerValue) => void;
}) {
  return (
    <section className="owner-form-answer">
      {question.contextSummary ? <QuestionContext summary={question.contextSummary} /> : null}
      <OwnerAnswerControl
        answer={answer}
        name={answerName}
        question={question.definition}
        onChange={onChange}
      />
      <SelectedAnswerLabel answer={answer} question={question.definition} />
    </section>
  );
}

function QuestionContext({ summary }: { summary: NonNullable<OwnerQuestionView["contextSummary"]> }) {
  return (
    <div className="owner-question-context">
      <h3>{summary.title}</h3>
      <p>Страница: {summary.page}</p>
      {summary.fields.length > 0 ? <p>Собирает: {summary.fields.join(", ")}</p> : null}
    </div>
  );
}

function SelectedAnswerLabel({ answer, question }: { answer?: OwnerAnswerValue; question: OwnerQuestionDefinition }) {
  const selectedLabel = selectedAnswerLabel(answer, question);
  return selectedLabel ? <p className="owner-selection">Выбрано: {selectedLabel}</p> : null;
}

function OwnerAnswerControl({
  answer,
  name,
  question,
  onChange
}: {
  answer?: OwnerAnswerValue;
  name?: string;
  question: OwnerQuestionDefinition;
  onChange: (answer: OwnerAnswerValue) => void;
}) {
  const unknownSelected = Boolean(answer && "unknown" in answer);

  if (question.answerType === "MULTI_SELECT") {
    const selected = answer && "type" in answer && answer.type === "MULTI_SELECT" ? answer.optionIds : [];
    return (
      <div className="owner-options" role="group" aria-label={question.text}>
        {question.options.map((option) => (
          <label className="owner-option" key={option.optionId}>
            <input
              checked={!unknownSelected && selected.includes(option.optionId)}
              type="checkbox"
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, option.optionId]
                  : selected.filter((optionId) => optionId !== option.optionId);
                onChange({ type: "MULTI_SELECT", optionIds: next });
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {question.allowUnknown ? <UnknownOption checked={unknownSelected} onChange={() => onChange({ unknown: true })} /> : null}
      </div>
    );
  }

  return (
    <div className="owner-options" role="radiogroup" aria-label={question.text}>
      {question.options.map((option) => (
        <label className="owner-option" key={option.optionId}>
          <input
            checked={answer && "type" in answer && answer.type === "SINGLE_SELECT" && answer.optionId === option.optionId}
            name={name ?? question.questionId}
            type="radio"
            onChange={() => onChange({ type: "SINGLE_SELECT", optionId: option.optionId })}
          />
          <span>{option.label}</span>
        </label>
      ))}
      {question.allowUnknown ? (
        <UnknownOption
          checked={unknownSelected}
          name={name ?? question.questionId}
          onChange={() => onChange({ unknown: true })}
        />
      ) : null}
    </div>
  );
}

function UnknownOption({
  checked,
  name,
  onChange
}: {
  checked: boolean;
  name?: string;
  onChange: () => void;
}) {
  return (
    <label className="owner-option">
      <input checked={checked} name={name} type={name ? "radio" : "checkbox"} onChange={onChange} />
      <span>Не знаю</span>
    </label>
  );
}

function NeutralConflictNotice() {
  return (
    <div className="owner-conflict" role="status">
      <h2>Нужно уточнение</h2>
      <p>
        Ваш ответ не совпадает с тем, что мы обнаружили на сайте. Мы не считаем это нарушением автоматически, но отметим этот пункт как требующий дополнительной проверки.
      </p>
    </div>
  );
}

function selectedAnswerLabel(answer: OwnerAnswerValue | undefined, question: OwnerQuestionDefinition): string | undefined {
  if (!answer || "unknown" in answer) {
    return undefined;
  }
  if (answer.type === "SINGLE_SELECT") {
    return question.options.find((option) => option.optionId === answer.optionId)?.label;
  }
  if (answer.type === "MULTI_SELECT") {
    return question.options
      .filter((option) => answer.optionIds.includes(option.optionId))
      .map((option) => option.label)
      .join(", ");
  }
  return answer.value ? "Да" : "Нет";
}

export function buildOwnerQuestionSteps(questions: OwnerQuestionView[]): OwnerQuestionStep[] {
  const personalDataQuestions = questions.filter(
    (question) => question.questionId === "Q_PD_COLLECTION_LEGAL_BASIS" && question.contextKey
  );
  const personalDataKeys = new Set(personalDataQuestions.map(questionKey));
  const steps: OwnerQuestionStep[] = [];

  if (personalDataQuestions.length > 1) {
    steps.push({
      kind: "personal-data-forms",
      key: "personal-data-forms",
      questions: personalDataQuestions
    });
  }

  for (const question of questions) {
    if (personalDataQuestions.length > 1 && personalDataKeys.has(questionKey(question))) {
      continue;
    }
    steps.push({ kind: "single", key: stepKeyForQuestion(question), questions: [question] });
  }

  return steps;
}

export function resolveStepIndex(steps: OwnerQuestionStep[], stepKey: string | undefined): number {
  if (stepKey) {
    const stepIndex = steps.findIndex((step) => step.key === stepKey);
    if (stepIndex !== -1) {
      return stepIndex;
    }
  }
  return firstOpenStepIndex(steps);
}

function firstOpenStepIndex(steps: OwnerQuestionStep[]): number {
  const index = steps.findIndex((step) => step.questions.some((question) => !question.answer));
  return index === -1 ? 0 : index;
}

function nextStepIndex(steps: OwnerQuestionStep[], currentIndex: number): number {
  const unansweredIndex = steps.findIndex((step) => step.questions.some((question) => !question.answer));
  if (unansweredIndex !== -1) {
    return unansweredIndex;
  }
  return Math.min(currentIndex + 1, steps.length);
}

export function nextStepIndexAfterAcknowledgedConflict(steps: OwnerQuestionStep[], currentIndex: number): number {
  return Math.min(currentIndex + 1, steps.length);
}

function initialDraftAnswers(ownerContext: OwnerContextResponse, previous: DraftAnswers = {}): DraftAnswers {
  return Object.fromEntries(
    ownerContext.requiredQuestions.map((question) => {
      const key = questionKey(question);
      return [key, previous[key] ?? question.answer?.answer];
    })
  );
}

function questionKey(question: Pick<OwnerQuestionView, "questionId" | "contextKey">): string {
  return `${question.questionId}::${question.contextKey}`;
}

function stepKeyForQuestion(question: Pick<OwnerQuestionView, "questionId" | "contextKey">): string {
  const slugs: Record<string, string> = {
    Q_PD_COLLECTION_LEGAL_BASIS: "personal-data-form",
    Q_MARKETING_CONSENT_PROOF: "marketing-consent",
    Q_PD_PRIMARY_DB_LOCATION: "data-storage",
    Q_PD_OPERATOR_RKN_NOTIFICATION: "rkn-notice",
    Q_AD_MATERIAL_QUALIFICATION: "advertising",
    Q_AUTH_OWNER_STATUS: "owner-status",
    Q_AUTH_METHODS: "sign-in-methods",
    Q_RECOMMENDER_TECH_USE: "recommendations",
    Q_LANGUAGE_EXCEPTION: "language"
  };
  const base = slugs[question.questionId] ?? "question";
  return question.contextKey ? `${base}-${stableHash(question.contextKey)}` : base;
}

function stableHash(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function replaceWizardLocation(scanId: string, stepKey?: string, done = false): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = done
    ? `/owner-context/${scanId}?done=1`
    : `/owner-context/${scanId}?step=${encodeURIComponent(stepKey ?? "")}`;
  window.history.replaceState(null, "", url);
}

function hasConflictForStep(step: OwnerQuestionStep, ownerContext: OwnerContextResponse): boolean {
  const stepQuestionIds = new Set(step.questions.map((question) => question.questionId));
  return ownerContext.conflicts.some((conflict) =>
    conflict.questionIds.some((questionId) => stepQuestionIds.has(questionId))
  );
}

export function shouldShowPersistedConflictForStep(
  step: OwnerQuestionStep,
  ownerContext: OwnerContextResponse,
  draftAnswers: DraftAnswers
): boolean {
  if (!hasConflictForStep(step, ownerContext)) {
    return false;
  }

  const conflictingQuestionIds = new Set(
    ownerContext.conflicts.flatMap((conflict) => conflict.questionIds)
  );

  return step.questions.some((question) => {
    if (!conflictingQuestionIds.has(question.questionId) || !question.answer) {
      return false;
    }
    return ownerAnswerValuesEqual(draftAnswers[questionKey(question)], question.answer.answer);
  });
}

export function ownerAnswerValuesEqual(left: OwnerAnswerValue | undefined, right: OwnerAnswerValue | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  if ("unknown" in left || "unknown" in right) {
    return "unknown" in left && "unknown" in right;
  }
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "YES_NO" && right.type === "YES_NO") {
    return left.value === right.value;
  }
  if (left.type === "SINGLE_SELECT" && right.type === "SINGLE_SELECT") {
    return left.optionId === right.optionId;
  }
  if (left.type === "MULTI_SELECT" && right.type === "MULTI_SELECT") {
    return [...left.optionIds].sort().join("\0") === [...right.optionIds].sort().join("\0");
  }
  return false;
}
