import type { ComponentType } from "react";
import {
  Brain,
  Pencil,
  Search as SearchIcon,
  Sparkles,
  Zap,
  type IconProps,
} from "@/components/ui/icons";

type OnboardingIcon = ComponentType<IconProps>;

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export type OnboardingGoalId =
  | "ship-features"
  | "fix-bugs"
  | "understand-codebase"
  | "automate-routine-work"
  | "evaluate-ai-coding";

export interface OnboardingGoal {
  id: OnboardingGoalId;
  label: string;
  description: string;
  icon: OnboardingIcon;
}

export const ONBOARDING_GOALS: readonly OnboardingGoal[] = [
  {
    id: "ship-features",
    label: "Ship features",
    description: "Turn ideas into production code with agent help.",
    icon: Sparkles,
  },
  {
    id: "fix-bugs",
    label: "Fix bugs",
    description: "Reproduce, diagnose, and patch issues faster.",
    icon: Pencil,
  },
  {
    id: "understand-codebase",
    label: "Understand a codebase",
    description: "Explore unfamiliar code and build mental models.",
    icon: Brain,
  },
  {
    id: "automate-routine-work",
    label: "Automate routine work",
    description: "Offload chores, refactors, and repetitive edits.",
    icon: Zap,
  },
  {
    id: "evaluate-ai-coding",
    label: "Evaluate AI coding",
    description: "Compare agents and see what they can do for you.",
    icon: SearchIcon,
  },
] as const;

// ---------------------------------------------------------------------------
// Goal → agent preference
// ---------------------------------------------------------------------------

// Ordered agent-kind preference per goal. The recommendation step intersects
// this with the set of available agent registries and falls back to
// compareChatLaunchKinds ordering if no preferred agent is present.
export const ONBOARDING_GOAL_AGENT_PREFERENCES: Record<
  OnboardingGoalId,
  readonly string[]
> = {
  "ship-features": ["codex", "claude"],
  "fix-bugs": ["codex", "claude"],
  "understand-codebase": ["claude", "codex"],
  "automate-routine-work": ["codex", "claude"],
  "evaluate-ai-coding": ["claude", "codex"],
};

// ---------------------------------------------------------------------------
// Version + copy
// ---------------------------------------------------------------------------

// Bumped when a new required onboarding step is added. Users below this
// version are sent through onboarding on launch. NOT a general
// UserPreferences schema version — governs the onboarding flow only.
export const CURRENT_ONBOARDING_VERSION = 2;

export type OnboardingStepKind = "intent" | "workflow" | "recommendations";

export const ONBOARDING_STEP_ORDER: readonly OnboardingStepKind[] = [
  "intent",
  "workflow",
  "recommendations",
] as const;

export const ONBOARDING_COPY = {
  stepTitles: {
    intent: "What kind of work are you here to do?",
    workflow: "Choose where we open files.",
    recommendations: "Choose your agent harness.",
  } satisfies Record<OnboardingStepKind, string>,
  stepDescriptions: {
    intent: "We'll shape your starting setup around it.",
    workflow: "We'll use this when a chat opens files for you.",
    recommendations: "Pick the harness you want to start with, then choose its model and mode.",
  } satisfies Record<OnboardingStepKind, string>,
  openTargetLabel: "Open files in",
  openTargetDetail: "You can change this later.",
  recommendationAgentLabel: "Harness",
  recommendationModelLabel: "Model",
  recommendationPermissionsLabel: "Mode",
  recommendationAgentHint: "Pick the harness you want to start with.",
  recommendationSuggestedLabel: "Recommended for the work you picked.",
  recommendationSummaryPrefix: "Recommended:",
  continueAction: "Continue",
  completeAction: "Start working",
  loadingTitle: "Preparing your starting setup",
  loadingDetail: "Pulling together the right defaults.",
  deferredDefaultsTitle: "Start working. We'll finish the rest shortly.",
  deferredDefaultsDetail: "We couldn't load recommendations yet, but we can keep going.",
  readyDetail: "We'll use these defaults in new chats.",
  homeLandingTitle: "Your workspace is ready.",
  homeLandingDetailByGoal: {
    "ship-features": "Start shipping features, open a repo, or pick up where you left off.",
    "fix-bugs": "Start tracking down a bug, open a repo, or pick up where you left off.",
    "understand-codebase": "Start exploring a codebase, open a repo, or pick up where you left off.",
    "automate-routine-work":
      "Start automating the repetitive work around your work, or pick up where you left off.",
    "evaluate-ai-coding": "Start putting agents to work, open a repo, or pick up where you left off.",
  } satisfies Record<OnboardingGoalId, string>,
} as const;

// ---------------------------------------------------------------------------
// Type guards — route-state boundary validation
// ---------------------------------------------------------------------------

const GOAL_IDS = new Set<string>(ONBOARDING_GOALS.map((g) => g.id));

export function isOnboardingGoalId(value: unknown): value is OnboardingGoalId {
  return typeof value === "string" && GOAL_IDS.has(value);
}
