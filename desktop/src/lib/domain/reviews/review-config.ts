import type {
  ReviewKind,
  ReviewPersonaRequest,
  StartCodeReviewRequest,
  StartPlanReviewRequest,
} from "@anyharness/sdk";
import { REVIEW_DEFAULT_MODE_ID_BY_AGENT_KIND } from "@/config/review-session-mode-defaults";
import { listConfiguredSessionControlValues } from "@/lib/domain/chat/session-controls/session-mode-control";

export const DEFAULT_REVIEW_MAX_ROUNDS = 2;
export const MAX_REVIEWERS_PER_RUN = 4;
export const MAX_REVIEW_ROUNDS = 10;

export interface ReviewSetupReviewerDraft {
  id: string;
  label: string;
  prompt: string;
  agentKind: string;
  modelId: string;
  modeId: string;
}

export interface ReviewSetupDraft {
  kind: ReviewKind;
  maxRounds: number;
  autoIterate: boolean;
  reviewers: ReviewSetupReviewerDraft[];
}

export type StoredReviewKindReviewers =
  | { mode: "inherit" }
  | { mode: "custom"; items: ReviewSetupReviewerDraft[] };

export interface StoredReviewKindDefaults {
  maxRounds: number;
  autoIterate: boolean;
  agentKind: string;
  modelId: string;
  modeId: string;
  reviewers: StoredReviewKindReviewers;
}

export type StoredReviewDefaultsByKind = Record<ReviewKind, StoredReviewKindDefaults | null>;

export interface ReviewSessionDefaults {
  agentKind: string;
  modelId: string | null;
  modeId: string | null;
}

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

export function listBuiltInReviewPersonaTemplates(kind: ReviewKind): ReviewPersonaTemplate[] {
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

export function createReviewSetupReviewerDraft(args: {
  kind: ReviewKind;
  sessionDefaults: ReviewSessionDefaults;
  existingReviewers: ReviewSetupReviewerDraft[];
  personalityTemplates?: ReviewPersonaTemplate[];
  templateId?: string | null;
}): ReviewSetupReviewerDraft | null {
  const templates = args.personalityTemplates ?? listReviewPersonaTemplates(args.kind);
  const template = templates.find(
    (candidate) => candidate.id === args.templateId,
  ) ?? templates[0] ?? null;
  if (!template) {
    return null;
  }

  return {
    id: nextReviewReviewerId(template.id, args.existingReviewers),
    label: template.label,
    prompt: template.prompt,
    agentKind: args.sessionDefaults.agentKind,
    modelId: args.sessionDefaults.modelId ?? "",
    modeId: resolveReviewExecutionModeIdForAgent(
      args.sessionDefaults.agentKind,
      args.sessionDefaults.modeId,
    ),
  };
}

export function nextReviewReviewerId(
  baseId: string,
  reviewers: ReviewSetupReviewerDraft[],
  ignoredIndex: number | null = null,
): string {
  const used = new Set(
    reviewers.flatMap((reviewer, index) => (
      ignoredIndex === index ? [] : [reviewer.id]
    )),
  );
  if (!used.has(baseId)) {
    return baseId;
  }
  for (let index = 2; index <= MAX_REVIEWERS_PER_RUN + 1; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `${baseId}-${Date.now()}`;
}

export function createReviewSetupDraft(args: {
  kind: ReviewKind;
  sessionDefaults: ReviewSessionDefaults;
  storedDefaults: StoredReviewKindDefaults | null | undefined;
  personalityTemplates?: ReviewPersonaTemplate[];
}): ReviewSetupDraft {
  const stored = args.storedDefaults;
  const templates = args.personalityTemplates ?? listReviewPersonaTemplates(args.kind);
  const defaultTemplates = templates.filter((template) =>
    isBuiltInReviewPersonaId(args.kind, template.id)
  );
  const sourceReviewers = resolveStoredReviewers(
    stored,
    defaultTemplates.length ? defaultTemplates : templates,
  );
  const defaultAgentKind = stored?.agentKind || args.sessionDefaults.agentKind;
  const defaultModelId = stored?.modelId || args.sessionDefaults.modelId || "";
  const defaultModeId = stored?.modeId || args.sessionDefaults.modeId || null;

  return {
    kind: args.kind,
    maxRounds: clampRounds(stored?.maxRounds ?? DEFAULT_REVIEW_MAX_ROUNDS),
    autoIterate: stored?.autoIterate ?? true,
    reviewers: sourceReviewers
      .slice(0, MAX_REVIEWERS_PER_RUN)
      .map((reviewer) => {
        const template = findReviewPersonaTemplateForReviewer(templates, reviewer.id);
        const reviewerAgentKind = reviewer.agentKind || defaultAgentKind;
        return {
          ...reviewer,
          label: template?.label ?? reviewer.label,
          prompt: template?.prompt ?? reviewer.prompt,
          agentKind: reviewerAgentKind,
          modelId: reviewer.modelId || defaultModelId,
          modeId: resolveReviewExecutionModeIdForAgent(
            reviewerAgentKind,
            reviewer.modeId || defaultModeId,
          ),
        };
      }),
  };
}

function resolveStoredReviewers(
  stored: StoredReviewKindDefaults | null | undefined,
  fallbackTemplates: ReviewPersonaTemplate[],
): ReviewSetupReviewerDraft[] {
  if (stored?.reviewers.mode === "custom") {
    return stored.reviewers.items;
  }
  return fallbackTemplates.map((template) => ({
    id: template.id,
    label: template.label,
    prompt: template.prompt,
    agentKind: "",
    modelId: "",
    modeId: "",
  }));
}

export function resolveReviewExecutionModeIdForAgent(
  agentKind: string,
  preferredModeId: string | null | undefined,
): string {
  const values = listConfiguredSessionControlValues(agentKind, "mode");
  const configuredDefault = REVIEW_DEFAULT_MODE_ID_BY_AGENT_KIND[agentKind];
  return values.find((value) => value.value === configuredDefault)?.value
    ?? values.find((value) => value.value === preferredModeId)?.value
    ?? values.find((value) => value.value !== "plan")?.value
    ?? values.find((value) => value.isDefault)?.value
    ?? values[0]?.value
    ?? "";
}

export function buildReviewRequest(
  draft: ReviewSetupDraft,
  parentSessionId: string,
): {
  request: StartPlanReviewRequest | StartCodeReviewRequest | null;
  error: string | null;
} {
  const reviewersToRun = draft.reviewers;
  if (reviewersToRun.length === 0) {
    return { request: null, error: "Add at least one reviewer." };
  }
  if (reviewersToRun.length > MAX_REVIEWERS_PER_RUN) {
    return { request: null, error: `Use up to ${MAX_REVIEWERS_PER_RUN} reviewers.` };
  }

  const reviewers: ReviewPersonaRequest[] = [];
  for (const reviewer of reviewersToRun) {
    const label = reviewer.label.trim();
    const prompt = reviewer.prompt.trim();
    const agentKind = reviewer.agentKind.trim();
    const modelId = reviewer.modelId.trim();
    const modeId = reviewer.modeId.trim();
    if (!label || !prompt) {
      return { request: null, error: "Every reviewer needs a label and prompt." };
    }
    if (!agentKind || !modelId || !modeId) {
      return {
        request: null,
        error: "Every reviewer needs a resolved agent and model.",
      };
    }
    reviewers.push({
      personaId: reviewer.id,
      label,
      prompt,
      agentKind,
      modelId,
      modeId,
    });
  }

  return {
    request: {
      parentSessionId,
      maxRounds: clampRounds(draft.maxRounds),
      autoIterate: draft.autoIterate,
      reviewers,
    },
    error: null,
  };
}

export function draftToStoredReviewDefaults(
  draft: ReviewSetupDraft,
  personalityTemplates: ReviewPersonaTemplate[] = listReviewPersonaTemplates(draft.kind),
): StoredReviewKindDefaults {
  const firstReviewer = draft.reviewers[0] ?? null;
  return {
    maxRounds: clampRounds(draft.maxRounds),
    autoIterate: draft.autoIterate,
    agentKind: firstReviewer?.agentKind.trim() ?? "",
    modelId: firstReviewer?.modelId.trim() ?? "",
    modeId: firstReviewer?.modeId.trim() ?? "",
    reviewers: {
      mode: "custom",
      items: draft.reviewers.slice(0, MAX_REVIEWERS_PER_RUN).map((reviewer) => {
        const template = findReviewPersonaTemplateForReviewer(personalityTemplates, reviewer.id);
        return {
          id: reviewer.id,
          label: (template?.label ?? reviewer.label).trim(),
          prompt: (template?.prompt ?? reviewer.prompt).trim(),
          agentKind: reviewer.agentKind.trim(),
          modelId: reviewer.modelId.trim(),
          modeId: reviewer.modeId.trim(),
        };
      }),
    },
  };
}

export function findReviewPersonaTemplateForReviewer(
  templates: ReviewPersonaTemplate[],
  reviewerId: string,
): ReviewPersonaTemplate | null {
  return templates.find((template) =>
    reviewerId === template.id || reviewerId.startsWith(`${template.id}-`)
  ) ?? null;
}

export function clampRounds(value: number): number {
  return Math.min(MAX_REVIEW_ROUNDS, Math.max(1, Math.round(value)));
}
