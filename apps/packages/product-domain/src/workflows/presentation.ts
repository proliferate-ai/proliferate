/**
 * Pure presentation helpers for workflow steps and cards (spec 3.6).
 *
 * Glyphs, labels, one-line previews, the goal two-line rail treatment, cap
 * formatting, and the home-card view model. No React — the UI layer renders
 * from these facts.
 */

import { truncateGoalObjective } from "../activity/goal";
import type {
  WorkflowDefinition,
  WorkflowGoal,
  WorkflowStep,
  WorkflowStepKind,
} from "./definition";

export interface WorkflowStepKindMeta {
  /** Compact glyph used in the home-card step strip (`◇ $ ⇈ 🔔 ⏸`). */
  glyph: string;
  label: string;
  /** One-word summary of what the step does, for empty previews. */
  hint: string;
}

/** Spec 3.6 step-glyph vocabulary. */
export const WORKFLOW_STEP_META: Record<WorkflowStepKind, WorkflowStepKindMeta> = {
  "agent.prompt": { glyph: "◇", label: "Prompt", hint: "Send a prompt" },
  "agent.config": { glyph: "⚙", label: "Agent", hint: "Set the agent" },
  "shell.run": { glyph: "$", label: "Script", hint: "Run a command" },
  "scm.open_pr": { glyph: "⇈", label: "Open PR", hint: "Open a pull request" },
  notify: { glyph: "🔔", label: "Notify", hint: "Send a notification" },
  "human.approval": { glyph: "⏸", label: "Approval", hint: "Wait for a human" },
  "workflow.include": { glyph: "⧉", label: "Include", hint: "Inline a workflow" },
};

/** Glyph shown for a step in the home-card strip. Goal-armed prompts show `◎`. */
export const WORKFLOW_GOAL_GLYPH = "◎";

export function stepStripGlyph(step: WorkflowStep): string {
  if (step.kind === "agent.prompt" && step.goal) {
    return WORKFLOW_GOAL_GLYPH;
  }
  return WORKFLOW_STEP_META[step.kind].glyph;
}

/** The glyph strip for a workflow card, in step order. */
export function workflowStepStrip(definition: WorkflowDefinition): string[] {
  return definition.steps.map(stepStripGlyph);
}

export function workflowStepKindLabel(kind: WorkflowStepKind): string {
  return WORKFLOW_STEP_META[kind].label;
}

const PREVIEW_MAX_CHARS = 96;

function collapse(value: string, maxChars = PREVIEW_MAX_CHARS): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** The `harness · model` summary line for an agent-config step (empty when unset). */
export function agentConfigSummary(step: {
  harness?: string;
  model?: string;
}): string {
  return [step.harness, step.model].filter((part) => part && part.trim()).join(" · ");
}

/** One-line content preview shown on a step card. */
export function workflowStepPreview(step: WorkflowStep): string {
  switch (step.kind) {
    case "agent.prompt":
      return collapse(step.prompt) || WORKFLOW_STEP_META[step.kind].hint;
    case "agent.config":
      return agentConfigSummary(step) || WORKFLOW_STEP_META[step.kind].hint;
    case "shell.run":
      return collapse(step.command) || WORKFLOW_STEP_META[step.kind].hint;
    case "scm.open_pr":
      return collapse(step.title) || WORKFLOW_STEP_META[step.kind].hint;
    case "notify":
      return collapse(step.message) || WORKFLOW_STEP_META[step.kind].hint;
    case "human.approval":
      return collapse(step.message) || WORKFLOW_STEP_META[step.kind].hint;
    case "workflow.include":
      return WORKFLOW_STEP_META[step.kind].hint;
  }
}

/**
 * The raw, whitespace-normalized-but-uncapped content of a step's primary field,
 * for the roomy rail card (line-clamp does the clamping). Returns "" when empty
 * so the card falls back to the kind hint.
 */
export function workflowStepExcerpt(step: WorkflowStep): string {
  const normalize = (value: string) => value.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  switch (step.kind) {
    case "agent.prompt":
      return normalize(step.prompt);
    case "agent.config":
      return agentConfigSummary(step);
    case "shell.run":
      return normalize(step.command);
    case "scm.open_pr":
      return normalize(step.title);
    case "notify":
    case "human.approval":
      return normalize(step.message);
    case "workflow.include":
      return "";
  }
}

// --- Caps / goal treatment -----------------------------------------------------

/** Compact duration: `90m`, `45s`, `2h`. */
export function formatWallSecs(seconds: number): string {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

/** Compact token count: `400k`, `1.2M`, `900`. */
export function formatTokenBudget(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return `${tokens}`;
}

/** The caps chip row for a goal: `25t · 90m · 400k`. */
export function goalCapsSummary(goal: WorkflowGoal): string {
  const parts = [`${goal.maxTurns}t`, formatWallSecs(goal.maxWallSecs)];
  if (goal.tokenBudget !== undefined) {
    parts.push(formatTokenBudget(goal.tokenBudget));
  }
  return parts.join(" · ");
}

export interface GoalRailLine {
  glyph: string;
  /** e.g. `until "make the tests pass" · 25t · 90m · 400k` */
  text: string;
}

/**
 * The distinct second line of a goal-armed prompt card (spec 3.6):
 *   `◎ until "…" · 25t · 90m`
 * Returns null when the step has no goal.
 */
export function goalRailLine(step: WorkflowStep): GoalRailLine | null {
  if (step.kind !== "agent.prompt" || !step.goal) {
    return null;
  }
  const objective = truncateGoalObjective(step.goal.objective, 60) || "goal met";
  return {
    glyph: WORKFLOW_GOAL_GLYPH,
    text: `until "${objective}" · ${goalCapsSummary(step.goal)}`,
  };
}

// --- Home card view model ------------------------------------------------------

export interface WorkflowTriggerChip {
  /** `manual` is always live; `schedule`/`poll` render, `chat`/`webhook`/`api` are W5-gated. */
  kind: "manual" | "schedule" | "poll" | "chat" | "webhook" | "api";
  label: string;
  /** Whether the trigger is wired in v1 (schedule/webhook/api render as "soon"). */
  live: boolean;
}

export interface WorkflowLastRunView {
  status: string;
  atLabel: string;
}

export interface WorkflowCardView {
  id: string;
  name: string;
  description: string | null;
  /** Step-glyph strip in order. */
  glyphs: string[];
  stepCount: number;
  /** Number of declared args — a Run needs the args form when > 0. */
  argCount: number;
  triggers: WorkflowTriggerChip[];
  lastRun: WorkflowLastRunView | null;
}

export interface BuildWorkflowCardInput {
  id: string;
  name: string;
  description?: string | null;
  definition: WorkflowDefinition;
  /** Extra triggers beyond the always-present Manual one (e.g. a schedule). */
  triggers?: WorkflowTriggerChip[];
  lastRun?: WorkflowLastRunView | null;
}

export function buildWorkflowCardView(input: BuildWorkflowCardInput): WorkflowCardView {
  const manual: WorkflowTriggerChip = { kind: "manual", label: "Manual", live: true };
  return {
    id: input.id,
    name: input.name,
    description: input.description ?? null,
    glyphs: workflowStepStrip(input.definition),
    stepCount: input.definition.steps.length,
    argCount: input.definition.args.length,
    triggers: [manual, ...(input.triggers ?? [])],
    lastRun: input.lastRun ?? null,
  };
}

/** Whether a Run should open the args form modal first (has declared args). */
export function workflowNeedsArgsForm(definition: WorkflowDefinition): boolean {
  return definition.args.length > 0;
}
