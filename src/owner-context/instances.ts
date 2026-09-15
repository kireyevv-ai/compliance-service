import type { Fact } from "@/facts/types";
import { getOwnerQuestionApplicability } from "./engine";
import { OWNER_QUESTION_BY_ID } from "./questions";
import type {
  OwnerAnswer,
  OwnerContextInput,
  OwnerQuestionContextSummary,
  OwnerQuestionDefinition
} from "./types";

const FORM_CONTEXT_FACTS = new Set(["personal_data_collection_found", "rendered_personal_data_collection_found"]);

export interface OwnerQuestionInstance {
  questionId: string;
  contextKey: string;
  contextSummary?: OwnerQuestionContextSummary;
  definition: OwnerQuestionDefinition;
  answer?: OwnerAnswer;
}

export function getRequiredOwnerQuestionInstances(context: OwnerContextInput): OwnerQuestionInstance[] {
  const instances: OwnerQuestionInstance[] = [];
  const pdDefinition = definitionFor("Q_PD_COLLECTION_LEGAL_BASIS");

  if (getOwnerQuestionApplicability("Q_PD_COLLECTION_LEGAL_BASIS", context) === "REQUIRED") {
    for (const formContext of getPersonalDataCollectionContexts(context.facts)) {
      instances.push({
        questionId: "Q_PD_COLLECTION_LEGAL_BASIS",
        contextKey: formContext.contextKey,
        contextSummary: formContext.contextSummary,
        definition: pdDefinition,
        answer: answerFor(context.answers, "Q_PD_COLLECTION_LEGAL_BASIS", formContext.contextKey)
      });
    }
  }

  for (const questionId of [
    "Q_MARKETING_CONSENT_PROOF",
    "Q_PD_PRIMARY_DB_LOCATION",
    "Q_PD_OPERATOR_RKN_NOTIFICATION",
    "Q_AD_MATERIAL_QUALIFICATION",
    "Q_AUTH_OWNER_STATUS",
    "Q_AUTH_METHODS",
    "Q_RECOMMENDER_TECH_USE",
    "Q_LANGUAGE_EXCEPTION"
  ]) {
    if (getOwnerQuestionApplicability(questionId, context) !== "REQUIRED") {
      continue;
    }
    instances.push({
      questionId,
      contextKey: "",
      definition: definitionFor(questionId),
      answer: answerFor(context.answers, questionId, "")
    });
  }

  return instances;
}

export function getPersonalDataCollectionContexts(facts: Fact[]): Array<{
  contextKey: string;
  contextSummary: OwnerQuestionContextSummary;
  factRefs: Fact[];
}> {
  const contexts = new Map<string, { contextKey: string; contextSummary: OwnerQuestionContextSummary; factRefs: Fact[] }>();

  for (const fact of facts) {
    if (!FORM_CONTEXT_FACTS.has(fact.factType) || !isPositive(fact)) {
      continue;
    }

    const contextKey = contextKeyForFact(fact);
    const existing = contexts.get(contextKey);
    if (existing) {
      existing.factRefs.push(fact);
      continue;
    }

    contexts.set(contextKey, {
      contextKey,
      contextSummary: {
        title: formTitleForFact(fact),
        page: pageForFact(fact),
        fields: fieldsForFact(fact)
      },
      factRefs: [fact]
    });
  }

  return [...contexts.values()];
}

function answerFor(answers: OwnerAnswer[], questionId: string, contextKey: string): OwnerAnswer | undefined {
  return answers.find((answer) => answer.questionId === questionId && answer.contextKey === contextKey);
}

function definitionFor(questionId: string): OwnerQuestionDefinition {
  const definition = OWNER_QUESTION_BY_ID.get(questionId);
  if (!definition) {
    throw new Error(`Owner question ${questionId} is not registered`);
  }
  return definition;
}

function contextKeyForFact(fact: Fact): string {
  const explicit = stringValue(fact.value.contextKey);
  if (explicit) {
    return explicit;
  }

  return [
    normalizePage(fact.pageUrl),
    stringValue(fact.value.formId),
    stringValue(fact.value.formSelector) ?? stringValue(fact.value.selector),
    stringValue(fact.value.formLabel) ?? stringValue(fact.value.heading),
    fieldsForFact(fact).join(",")
  ]
    .filter(Boolean)
    .join("#");
}

function formTitleForFact(fact: Fact): string {
  const label = stringValue(fact.value.formLabel) ?? stringValue(fact.value.heading);
  if (label) {
    return `Форма «${label}»`;
  }

  const pageTitle = stringValue(fact.value.pageTitle);
  if (pageTitle) {
    return `Форма на странице «${pageTitle}»`;
  }

  return "Форма на странице";
}

function pageForFact(fact: Fact): string {
  const pageUrl = fact.pageUrl ?? stringValue(fact.value.pageUrl) ?? "";
  return normalizePage(pageUrl) || pageUrl || "страница сайта";
}

function normalizePage(pageUrl: unknown): string {
  const value = stringValue(pageUrl);
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return value;
  }
}

function fieldsForFact(fact: Fact): string[] {
  const rawFields = Array.isArray(fact.value.fields)
    ? fact.value.fields
    : Array.isArray(fact.value.fieldTypes)
      ? fact.value.fieldTypes
      : [];
  const labels = rawFields.map(fieldLabel).filter((label): label is string => Boolean(label));
  return [...new Set(labels)];
}

function fieldLabel(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? stringValue((value as Record<string, unknown>).label) ??
          stringValue((value as Record<string, unknown>).name) ??
          stringValue((value as Record<string, unknown>).type)
        : undefined;

  if (!raw) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  const dictionary: Record<string, string> = {
    name: "имя",
    full_name: "имя",
    fio: "ФИО",
    phone: "телефон",
    tel: "телефон",
    email: "электронная почта",
    mail: "электронная почта",
    address: "адрес"
  };
  return dictionary[normalized] ?? raw;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPositive(fact: Fact): boolean {
  return fact.value.found === true || fact.value.detected === true || Object.keys(fact.value).length > 0;
}
