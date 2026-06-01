import type { ReviewKind } from "@anyharness/sdk";

export interface ReviewPersonaTemplate {
  id: string;
  label: string;
  prompt: string;
}

export interface ReviewPersonalityPreference {
  id: string;
  label: string;
  prompt: string;
}

export type StoredReviewPersonalitiesByKind = Record<ReviewKind, ReviewPersonalityPreference[]>;

const PLAN_REVIEW_PERSONAS: ReviewPersonaTemplate[] = [
  {
    id: "plan-skeptic",
    label: "Plan skeptic",
    prompt:
      "Critique the plan for unclear goals, hidden assumptions, sequencing problems, missing files/tests, and risks that would make implementation fail. Pass only if the plan is precise enough for another agent to execute.",
  },
  {
    id: "implementation-readiness",
    label: "Readiness reviewer",
    prompt:
      "Review whether the plan fits the repository architecture and implementation workflow. Focus on ownership boundaries, migration/contract impacts, verification, and whether the plan has a concrete continuation path.",
  },
];

const CODE_REVIEW_PERSONAS: ReviewPersonaTemplate[] = [
  {
    id: "correctness-reviewer",
    label: "Correctness reviewer",
    prompt:
      "Review the current implementation state for bugs, regressions, broken contracts, missing edge cases, and behavior that contradicts the intended feature. Pass only when there are no actionable correctness concerns.",
  },
  {
    id: "integration-reviewer",
    label: "Integration reviewer",
    prompt:
      "Review how the implementation fits the existing repository patterns. Focus on API/SDK/UI wiring, lifecycle concerns, tests, migration safety, and maintainability.",
  },
];

export function listBuiltInReviewPersonaTemplates(
  kind: ReviewKind,
): ReviewPersonaTemplate[] {
  return kind === "plan" ? PLAN_REVIEW_PERSONAS : CODE_REVIEW_PERSONAS;
}

export function listReviewPersonaTemplates(
  kind: ReviewKind,
  storedPersonalities: ReviewPersonalityPreference[] = [],
): ReviewPersonaTemplate[] {
  return resolveReviewPersonaTemplates(kind, storedPersonalities);
}

export function resolveReviewPersonaTemplates(
  kind: ReviewKind,
  storedPersonalities: ReviewPersonalityPreference[],
): ReviewPersonaTemplate[] {
  const builtIns = listBuiltInReviewPersonaTemplates(kind);
  const builtInIds = new Set(builtIns.map((template) => template.id));
  const overrides = new Map(
    storedPersonalities
      .filter((personality) => builtInIds.has(personality.id))
      .map((personality) => [personality.id, personality]),
  );
  const resolvedBuiltIns = builtIns.map((template) => {
    const override = overrides.get(template.id);
    return override
      ? { id: template.id, label: override.label, prompt: override.prompt }
      : template;
  });
  const customPersonalities = storedPersonalities.filter((personality) => (
    !builtInIds.has(personality.id)
  ));
  return [...resolvedBuiltIns, ...customPersonalities];
}

export function isBuiltInReviewPersonaId(kind: ReviewKind, id: string): boolean {
  return listBuiltInReviewPersonaTemplates(kind).some((template) => template.id === id);
}

export function findReviewPersonaTemplateForReviewer(
  templates: ReviewPersonaTemplate[],
  reviewerId: string,
): ReviewPersonaTemplate | null {
  return templates.find((template) =>
    reviewerId === template.id || reviewerId.startsWith(`${template.id}-`)
  ) ?? null;
}
