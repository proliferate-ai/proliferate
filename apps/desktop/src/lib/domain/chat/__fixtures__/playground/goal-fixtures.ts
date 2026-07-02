import type { GoalCapabilities, GoalWire } from "@proliferate/product-domain/activity/goal";

const GOAL_FIXTURE_UPDATED_AT_MS = 1_751_450_000_000;

function goalFixture(overrides: Partial<GoalWire>): GoalWire {
  return {
    objective: "DONE.txt exists in the repo root and contains exactly \"done\"",
    status: "active",
    nativeStatus: "active",
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    metReason: null,
    iterations: null,
    native: true,
    updatedAtMs: GOAL_FIXTURE_UPDATED_AT_MS,
    ...overrides,
  };
}

/** Codex-shaped capability: native goals with a native pause path. */
export const GOAL_CAPABILITIES_PAUSABLE: GoalCapabilities = {
  supported: true,
  native: true,
  pause: true,
};

/** Claude-shaped capability: native goals, no native pause. */
export const GOAL_CAPABILITIES_NO_PAUSE: GoalCapabilities = {
  supported: true,
  native: true,
  pause: false,
};

export const GOAL_ACTIVE_SHORT = goalFixture({});

export const GOAL_ACTIVE_LONG = goalFixture({
  objective:
    "All 14 flaky integration tests in tests/live_sessions/ pass 20 consecutive runs "
    + "under the stress harness, the root-cause fix is committed with a regression test "
    + "per failure mode, and CHANGELOG.md documents each fix with a link to the failing run",
  tokenBudget: 250_000,
  tokensUsed: 41_872,
  timeUsedSeconds: 312,
});

export const GOAL_PAUSED = goalFixture({
  status: "paused",
  nativeStatus: "paused",
  tokensUsed: 12_004,
  timeUsedSeconds: 95,
});

export const GOAL_MET = goalFixture({
  status: "met",
  nativeStatus: "complete",
  metReason: "DONE.txt exists in the repo root and its contents are exactly \"done\"",
  iterations: 4,
});

export const GOAL_BLOCKED = goalFixture({
  status: "blocked",
  nativeStatus: "blocked",
  tokensUsed: 88_310,
  timeUsedSeconds: 1_240,
});

export const GOAL_FAILED_BUDGET = goalFixture({
  status: "failed",
  nativeStatus: "budgetLimited",
  tokenBudget: 50_000,
  tokensUsed: 50_000,
  timeUsedSeconds: 421,
});

export type GoalFixtureKey =
  | "active"
  | "active-long"
  | "active-claude"
  | "paused"
  | "met"
  | "blocked"
  | "failed-budget";

export interface GoalFixtureState {
  goal: GoalWire;
  capabilities: GoalCapabilities;
}

export const GOAL_FIXTURES: Record<GoalFixtureKey, GoalFixtureState> = {
  "active": { goal: GOAL_ACTIVE_SHORT, capabilities: GOAL_CAPABILITIES_PAUSABLE },
  "active-long": { goal: GOAL_ACTIVE_LONG, capabilities: GOAL_CAPABILITIES_PAUSABLE },
  "active-claude": { goal: GOAL_ACTIVE_SHORT, capabilities: GOAL_CAPABILITIES_NO_PAUSE },
  "paused": { goal: GOAL_PAUSED, capabilities: GOAL_CAPABILITIES_PAUSABLE },
  "met": { goal: GOAL_MET, capabilities: GOAL_CAPABILITIES_NO_PAUSE },
  "blocked": { goal: GOAL_BLOCKED, capabilities: GOAL_CAPABILITIES_PAUSABLE },
  "failed-budget": { goal: GOAL_FAILED_BUDGET, capabilities: GOAL_CAPABILITIES_PAUSABLE },
};

export function resolveGoalFixture(raw: string | undefined): GoalFixtureState | null {
  if (!raw) {
    return null;
  }
  const key = raw.trim();
  return key in GOAL_FIXTURES ? GOAL_FIXTURES[key as GoalFixtureKey] : null;
}
