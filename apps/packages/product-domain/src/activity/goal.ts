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
  /**
   * Whether a goal set/edit applies at a discrete turn boundary, so it reads
   * honestly as a standalone transcript row. True for harnesses where a
   * `/goal` edit arms at the turn boundary and fires its own `goal_updated`
   * (Claude); false where an edit steers the running turn live with no
   * discrete "applied" moment (codex), in which case a set/edit row would
   * misrepresent what happened. Terminal/status rows (paused/resumed/blocked/
   * met/failed/cleared) are unaffected — they render for every harness.
   */
  setEditTranscriptRows: boolean;
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

/**
 * Label for the goal bar's expand-popover "why" section — varies by outcome
 * so it always reads naturally instead of a generic "Reason" for every
 * terminal state (live feedback 2026-07-03).
 */
export function goalResultWhyLabel(outcome: GoalResultOutcome): string {
  switch (outcome) {
    case "met":
      return "Why it's met";
    case "blocked":
      return "Why it's blocked";
    case "failed":
      return "Why it stopped";
  }
}

export interface GoalStat {
  key: "iterations" | "tokensUsed" | "timeUsedSeconds";
  text: string;
}

/**
 * Compact usage stats for the goal bar's expand popover — only the fields
 * the harness actually reported (Claude sends `iterations`; both harnesses
 * send `tokensUsed`/`timeUsedSeconds` where budgets are tracked). Empty when
 * the goal carries no usage data at all, so the caller can skip the row.
 */
export function goalResultStats(
  goal: Pick<GoalWire, "iterations" | "tokensUsed" | "timeUsedSeconds">,
): GoalStat[] {
  const stats: GoalStat[] = [];
  if (goal.iterations !== null) {
    stats.push({
      key: "iterations",
      text: `${goal.iterations} ${goal.iterations === 1 ? "iteration" : "iterations"}`,
    });
  }
  if (goal.tokensUsed !== null) {
    stats.push({ key: "tokensUsed", text: `${goal.tokensUsed.toLocaleString()} tokens` });
  }
  if (goal.timeUsedSeconds !== null) {
    stats.push({ key: "timeUsedSeconds", text: humanizeGoalDurationSeconds(goal.timeUsedSeconds) });
  }
  return stats;
}

/** Compact duration label for the stats row: `"45s"`, `"3m 12s"`, `"1h 4m"`. */
export function humanizeGoalDurationSeconds(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/**
 * Inline "goal met" marker label for the final completed message's action
 * footer (codex-style "✓ Goal achieved in 40s"). Appends the elapsed time
 * when the met goal reported `timeUsedSeconds`; otherwise just the base
 * "Goal achieved" — never a bare "in" with no duration.
 */
export function goalMetMarkerLabel(
  goal: Pick<GoalWire, "timeUsedSeconds">,
): string {
  if (goal.timeUsedSeconds !== null && goal.timeUsedSeconds > 0) {
    return `Goal achieved in ${humanizeGoalDurationSeconds(goal.timeUsedSeconds)}`;
  }
  return "Goal achieved";
}
