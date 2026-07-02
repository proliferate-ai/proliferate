/**
 * Session goal — pure mirror of the pinned GoalPort wire contract v1.
 *
 * `GoalWire` is exactly the normalized shape the sidecars emit
 * (`_anyharness/goal/*` ext methods + `goal_updated|goal_met|goal_cleared`
 * notification chunks). Goals are strict mirrors of native harness state:
 * this module never invents state, it only derives display facts from a
 * round-tripped wire payload.
 */

export const GOAL_STATUSES = [
  "active",
  "paused",
  "blocked",
  "met",
  "failed",
  "cleared",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface GoalWire {
  objective: string;
  status: GoalStatus;
  /** Raw harness status string, verbatim (e.g. codex "budgetLimited"). */
  nativeStatus: string;
  tokenBudget: number | null;
  tokensUsed: number | null;
  timeUsedSeconds: number | null;
  /** Claude evaluator reason / codex terminal detail. Always null on codex goal_met. */
  metReason: string | null;
  /** Claude only. */
  iterations: number | null;
  native: boolean;
  updatedAtMs: number;
}

/**
 * Per-session goal capability, projected from the harness capability
 * advertisement (`InitializeResponse._meta.anyharness.goals`). The UI gates
 * on these flags only — never on a harness name.
 */
export interface GoalCapabilities {
  supported: boolean;
  native: boolean;
  /**
   * Whether pause/resume round-trips natively (codex goal engine). When
   * false the pause control renders disabled — pausing is not emulated.
   */
  pause: boolean;
}

export function isGoalStatus(value: unknown): value is GoalStatus {
  return typeof value === "string" && (GOAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Strict parse of a wire payload into a `GoalWire`. Returns null on any
 * shape violation — a malformed mirror must read as "no goal", never as a
 * fabricated one.
 */
export function parseGoalWire(value: unknown): GoalWire | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.objective !== "string" || !isGoalStatus(record.status)) {
    return null;
  }
  if (typeof record.nativeStatus !== "string") {
    return null;
  }
  if (typeof record.native !== "boolean" || typeof record.updatedAtMs !== "number") {
    return null;
  }
  const tokenBudget = nullableNumber(record.tokenBudget);
  const tokensUsed = nullableNumber(record.tokensUsed);
  const timeUsedSeconds = nullableNumber(record.timeUsedSeconds);
  const metReason = nullableString(record.metReason);
  const iterations = nullableNumber(record.iterations);
  if (
    tokenBudget === undefined
    || tokensUsed === undefined
    || timeUsedSeconds === undefined
    || metReason === undefined
    || iterations === undefined
  ) {
    return null;
  }
  return {
    objective: record.objective,
    status: record.status,
    nativeStatus: record.nativeStatus,
    tokenBudget,
    tokensUsed,
    timeUsedSeconds,
    metReason,
    iterations,
    native: record.native,
    updatedAtMs: record.updatedAtMs,
  };
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

export type GoalResultOutcome = "met" | "blocked" | "failed";

export type GoalBarState =
  | { kind: "hidden" }
  | { kind: "live"; phase: "pursuing" | "paused"; goal: GoalWire }
  | {
    kind: "result";
    outcome: GoalResultOutcome;
    headline: string;
    detail: string | null;
    goal: GoalWire;
  };

/**
 * The one status derivation the goal bar renders from: live states keep the
 * bar ever-present with controls; terminal states become the sticky result
 * until dismissed or replaced; cleared/absent means no bar at all.
 */
export function deriveGoalBarState(goal: GoalWire | null): GoalBarState {
  if (!goal || goal.status === "cleared") {
    return { kind: "hidden" };
  }
  switch (goal.status) {
    case "active":
      return { kind: "live", phase: "pursuing", goal };
    case "paused":
      return { kind: "live", phase: "paused", goal };
    case "met":
      return { kind: "result", outcome: "met", headline: "Goal met", detail: goal.metReason, goal };
    case "blocked":
      return {
        kind: "result",
        outcome: "blocked",
        headline: "Blocked",
        detail: goal.metReason ?? "needs you",
        goal,
      };
    case "failed":
      return {
        kind: "result",
        outcome: "failed",
        headline: "Goal stopped",
        detail: goalFailureDetail(goal),
        goal,
      };
  }
}

/**
 * Failure detail comes from the verbatim native status — codex keeps the
 * terminal budget/usage detail there, not in `metReason`.
 */
export function goalFailureDetail(goal: GoalWire): string | null {
  switch (goal.nativeStatus) {
    case "budgetLimited":
      return "budget exhausted";
    case "usageLimited":
      return "usage limit reached";
    default:
      return goal.metReason;
  }
}

export type GoalTone = "default" | "muted" | "positive" | "attention" | "danger";

export function goalStatusLabel(status: GoalStatus): string {
  switch (status) {
    case "active":
      return "Pursuing goal";
    case "paused":
      return "Goal paused";
    case "blocked":
      return "Blocked";
    case "met":
      return "Goal met";
    case "failed":
      return "Goal stopped";
    case "cleared":
      return "Goal cleared";
  }
}

export function goalStatusTone(status: GoalStatus): GoalTone {
  switch (status) {
    case "active":
      return "default";
    case "paused":
    case "cleared":
      return "muted";
    case "met":
      return "positive";
    case "blocked":
      return "attention";
    case "failed":
      return "danger";
  }
}

export const GOAL_OBJECTIVE_PREVIEW_MAX_CHARS = 120;

/**
 * One-line preview of an objective: whitespace collapsed, hard-capped with
 * an ellipsis. The bar additionally CSS-truncates to its own width; this cap
 * keeps tooltips/fixtures and non-flex surfaces bounded.
 */
export function truncateGoalObjective(
  objective: string,
  maxChars: number = GOAL_OBJECTIVE_PREVIEW_MAX_CHARS,
): string {
  const collapsed = objective.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
