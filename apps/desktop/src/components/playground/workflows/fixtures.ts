/**
 * Fixture layer for the Managed Workflow Product Experience mock.
 *
 * Definition/run/step lifecycle shapes mirror the frozen contracts
 * (specs/codebase/systems/product/workflows/{definitions,runs,run-control}.md).
 *
 * PROVISIONAL: the delivery/desired/freshness presentation dimensions come
 * from the draft-0.8 product doc, not a frozen API. Endpoint names and
 * correlation fields freeze in the Managed Cloud execution PR — nothing in
 * this file is wire truth.
 */

// --- Frozen lifecycle vocabulary (run-control.md §3.2) ---------------------

export type MockExecutionStatus =
  | "none"
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type MockStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

// --- PROVISIONAL Cloud presentation dimensions (doc 6, draft 0.8) ----------

export type MockDelivery =
  | "prepared"
  | "queued"
  | "delivering"
  | "accepted"
  | "delivery_failed"
  | "delivery_cancelled";

export type MockDesired = "active" | "cancelled";

export type MockFreshness = "pending" | "live" | "stale" | "unreachable" | "target_lost";

// --- Definition fixtures (definitions.md shape) -----------------------------

export type MockInputType = "string" | "number" | "boolean";

export interface MockInput {
  name: string;
  type: MockInputType;
  required: boolean;
  /** Optional input referenced by the one prompt: must be supplied per run. */
  referencedByPrompt: boolean;
}

export interface MockStep {
  kind: "agent.prompt";
  prompt: string;
  goal?: { objective: string };
}

export interface MockStage {
  agentKind: "claude" | "codex";
  modelId?: string;
  effort?: string;
  steps: MockStep[];
}

export type MockPlacement =
  | { kind: "repositoryWorktree"; repo: string }
  | { kind: "scratch" };

export interface MockDefinition {
  title: string;
  description: string;
  revision: number;
  placement: MockPlacement;
  inputs: MockInput[];
  stages: MockStage[];
}

export interface MockBlocker {
  code: string;
  path: string;
  message: string;
}

/** Tiny stand-in for the agent catalog: models and reasoning levels per harness. */
export const MOCK_CATALOG: Record<
  MockStage["agentKind"],
  { models: string[]; efforts: Record<string, string[]> }
> = {
  claude: {
    models: ["claude-sonnet-4-6", "claude-opus-4-6"],
    efforts: {
      "claude-sonnet-4-6": ["low", "medium", "high"],
      "claude-opus-4-6": ["low", "medium", "high", "xhigh"],
    },
  },
  codex: {
    models: ["gpt-5.2-codex"],
    efforts: { "gpt-5.2-codex": ["medium", "high"] },
  },
};

// --- Run fixture -------------------------------------------------------------

export interface MockRun {
  /** One immutable invocation UUID per launch attempt. */
  invocationId: string;
  createdAt: string;
  updatedAt: string;
  stateVersion: number;
  delivery: MockDelivery;
  desired: MockDesired;
  execution: MockExecutionStatus;
  freshness: MockFreshness;
  /** Absent until the first successful runtime observation. */
  lastObservedAt?: string;
  cancelRequestedAt?: string;
  interruptionCode?: "runtime_restarted";
  failureCode?: string;
  step: { status: MockStepStatus; startedAt?: string; finishedAt?: string };
  placement: MockPlacement;
  arguments: Record<string, string | number | boolean>;
  /** PROVISIONAL safe open target (no tokens, no transcript). */
  correlation?: {
    cloudWorkspaceId: string;
    anyharnessWorkspaceId: string;
    sessionId: string;
  };
  sessionAvailability: "available" | "unavailable";
}

// --- Shared fixture data ------------------------------------------------------

const REPO_PLACEMENT: MockPlacement = {
  kind: "repositoryWorktree",
  repo: "proliferate-ai/proliferate",
};

export const ELIGIBLE_DEFINITION: MockDefinition = {
  title: "Sentry issue triage",
  description: "Investigates one Sentry issue and reports whether it is fixable.",
  revision: 4,
  placement: REPO_PLACEMENT,
  inputs: [
    { name: "issue_id", type: "string", required: true, referencedByPrompt: true },
    { name: "severity", type: "string", required: false, referencedByPrompt: true },
    { name: "max_files", type: "number", required: false, referencedByPrompt: false },
    { name: "include_logs", type: "boolean", required: false, referencedByPrompt: false },
  ],
  stages: [
    {
      agentKind: "claude",
      modelId: "claude-sonnet-4-6",
      effort: "high",
      steps: [
        {
          kind: "agent.prompt",
          prompt:
            "Investigate Sentry issue {{inputs.issue_id}} (severity {{inputs.severity}}). Reproduce it, find the root cause, and summarize whether it is fixable.",
        },
      ],
    },
  ],
};

export const SCRATCH_DEFINITION: MockDefinition = {
  title: "Weekly dependency report",
  description: "Surveys the ecosystem and drafts a dependency-risk report.",
  revision: 2,
  placement: { kind: "scratch" },
  inputs: [{ name: "focus_area", type: "string", required: true, referencedByPrompt: true }],
  stages: [
    {
      agentKind: "claude",
      steps: [
        {
          kind: "agent.prompt",
          prompt: "Research current advisories for {{inputs.focus_area}} and draft a short report.",
        },
      ],
    },
  ],
};

export const INELIGIBLE_DEFINITION: MockDefinition = {
  title: "Sentry triage & fix",
  description: "Triage, then fix and open a PR. Saved beyond the runnable Core V1 subset.",
  revision: 9,
  placement: REPO_PLACEMENT,
  inputs: [
    { name: "issue_id", type: "string", required: true, referencedByPrompt: true },
    { name: "severity", type: "string", required: false, referencedByPrompt: true },
  ],
  stages: [
    {
      agentKind: "claude",
      modelId: "claude-sonnet-4-6",
      steps: [
        {
          kind: "agent.prompt",
          prompt: "Investigate Sentry issue {{inputs.issue_id}} and decide if it is fixable.",
        },
        {
          kind: "agent.prompt",
          prompt: "Implement the fix and make the test suite pass.",
          goal: { objective: "The failing test passes and no other suite regresses." },
        },
      ],
    },
    {
      agentKind: "codex",
      modelId: "gpt-5.2-codex",
      steps: [{ kind: "agent.prompt", prompt: "Review the diff and open a PR." }],
    },
  ],
};

// --- Run builders ---------------------------------------------------------------

const BASE_ARGS = { issue_id: "PROLIF-2201", severity: "high" };

const CORRELATION = {
  cloudWorkspaceId: "cw_7f31a9d2",
  anyharnessWorkspaceId: "ahw_02c9e4b1",
  sessionId: "ses_b4d81f6e",
};

function run(overrides: Partial<MockRun> & { invocationId: string }): MockRun {
  return {
    createdAt: "Today 14:28",
    updatedAt: "Today 14:32",
    stateVersion: 4,
    delivery: "accepted",
    desired: "active",
    execution: "running",
    freshness: "live",
    lastObservedAt: "Today 14:32",
    step: { status: "running", startedAt: "Today 14:29" },
    placement: REPO_PLACEMENT,
    arguments: BASE_ARGS,
    correlation: CORRELATION,
    sessionAvailability: "available",
    ...overrides,
  };
}

/** Two settled runs that pad recent-run lists so rows read realistically. */
const HISTORY_RUNS: MockRun[] = [
  run({
    invocationId: "8c1f2e6a-4b0d-4e51-9a37-d2c5f8b91e04",
    createdAt: "Today 11:02",
    updatedAt: "Today 11:14",
    stateVersion: 7,
    execution: "completed",
    lastObservedAt: "Today 11:14",
    step: { status: "completed", startedAt: "Today 11:03", finishedAt: "Today 11:14" },
    arguments: { issue_id: "PROLIF-2198", severity: "medium" },
  }),
  run({
    invocationId: "5d9ab3c7-1e42-4f08-b6d9-0a83c1f47e22",
    createdAt: "Yesterday 18:40",
    updatedAt: "Yesterday 18:47",
    stateVersion: 6,
    execution: "failed",
    failureCode: "prompt_dispatch_failed",
    lastObservedAt: "Yesterday 18:47",
    step: { status: "failed", startedAt: "Yesterday 18:41", finishedAt: "Yesterday 18:47" },
    arguments: { issue_id: "PROLIF-2190", severity: "high" },
  }),
];

// --- Scenarios -------------------------------------------------------------------

export type MockScreen = "detail" | "history" | "run";

export interface MockScenario {
  id: string;
  label: string;
  note: string;
  definition: MockDefinition;
  argPreset: "empty" | "valid" | "invalid";
  runs: MockRun[];
  initialScreen: MockScreen;
}

function focusScenario(
  id: string,
  label: string,
  note: string,
  focus: MockRun,
  extra?: Partial<Omit<MockScenario, "id" | "label" | "note" | "runs">>,
): MockScenario {
  return {
    id,
    label,
    note,
    definition: ELIGIBLE_DEFINITION,
    argPreset: "valid",
    runs: [focus, ...HISTORY_RUNS],
    initialScreen: "run",
    ...extra,
  };
}

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  {
    id: "eligible-ready",
    label: "Eligible & ready",
    note: "Runnable Core V1 definition; arguments empty; two settled runs in history.",
    definition: ELIGIBLE_DEFINITION,
    argPreset: "empty",
    runs: HISTORY_RUNS,
    initialScreen: "detail",
  },
  {
    id: "ineligible-definition",
    label: "Ineligible (multi-step)",
    note: "Saved definition broader than the runnable subset: ordered blockers, run controls absent.",
    definition: INELIGIBLE_DEFINITION,
    argPreset: "empty",
    runs: [],
    initialScreen: "detail",
  },
  {
    id: "invalid-arguments",
    label: "Invalid arguments",
    note: "Missing required input + number outside the portable safe range; no invocation is created.",
    definition: ELIGIBLE_DEFINITION,
    argPreset: "invalid",
    runs: HISTORY_RUNS,
    initialScreen: "detail",
  },
  focusScenario(
    "prepared",
    "Prepared",
    "Invocation exists but delivery was never requested (deliver call lost). Same-UUID Start delivery.",
    run({
      invocationId: "3e7c9d1f-8a24-4b6e-a1c5-f0d2b8e64a17",
      stateVersion: 1,
      delivery: "prepared",
      execution: "none",
      freshness: "pending",
      lastObservedAt: undefined,
      step: { status: "pending" },
      correlation: undefined,
      updatedAt: "Today 14:28",
    }),
  ),
  focusScenario(
    "delivering",
    "Queued / delivering",
    "Delivery in flight; no runtime execution yet.",
    run({
      invocationId: "9b4e2f7a-0c58-4d13-8e6b-a7f1c3d92b50",
      stateVersion: 1,
      delivery: "delivering",
      execution: "none",
      freshness: "pending",
      lastObservedAt: undefined,
      step: { status: "pending" },
      correlation: undefined,
      updatedAt: "Today 14:29",
    }),
  ),
  focusScenario(
    "running",
    "Accepted / running",
    "Runtime accepted the run; the one prompt step is live.",
    run({ invocationId: "b2d64a8e-5f19-4c07-9d3a-e8c0f1b7d642" }),
  ),
  focusScenario(
    "cancel-requested",
    "Cancellation requested",
    "Durable cancel intent recorded; the turn may still complete truthfully. Never shown as Cancelled.",
    run({
      invocationId: "6a3f8b2d-9e51-4708-bc4e-1d7a0c5f9e83",
      stateVersion: 6,
      desired: "cancelled",
      cancelRequestedAt: "Today 14:31",
    }),
  ),
  focusScenario(
    "completed",
    "Completed",
    "Proven terminal outcome; terminal state never ages into stale.",
    run({
      invocationId: "e1c5d7f3-2b86-4a90-8f1d-c4e9a0b32d75",
      stateVersion: 8,
      execution: "completed",
      updatedAt: "Today 14:41",
      step: { status: "completed", startedAt: "Today 14:29", finishedAt: "Today 14:41" },
    }),
  ),
  focusScenario(
    "failed",
    "Failed",
    "Terminal failure with its stable failure code.",
    run({
      invocationId: "4f8a1c6b-7d20-4e35-92c8-b5f3e0d81a49",
      stateVersion: 5,
      execution: "failed",
      failureCode: "session_turn_failed",
      updatedAt: "Today 14:36",
      step: { status: "failed", startedAt: "Today 14:29", finishedAt: "Today 14:36" },
    }),
  ),
  focusScenario(
    "interrupted",
    "Interrupted (restart)",
    "Runtime restart fenced the run: interrupted, not replayed, not retried.",
    run({
      invocationId: "7d2b9e4f-1a63-4c58-b0d7-f8e5a2c19b36",
      stateVersion: 5,
      execution: "interrupted",
      interruptionCode: "runtime_restarted",
      updatedAt: "Today 14:35",
      step: { status: "interrupted", startedAt: "Today 14:29", finishedAt: "Today 14:35" },
    }),
  ),
  focusScenario(
    "stale",
    "Stale",
    "Observation cadence lapsed; last known state stays visible with its timestamp.",
    run({
      invocationId: "0c6e3a9d-8f47-4b21-a5e0-d1b7c4f86e93",
      freshness: "stale",
      lastObservedAt: "Today 14:27",
    }),
  ),
  focusScenario(
    "unreachable-never",
    "Unreachable · never observed",
    "Runtime unreachable before any successful projection: no fabricated state or timestamp.",
    run({
      invocationId: "a9f4b7e1-3c62-4d08-95a1-e6d0c8b25f74",
      stateVersion: 2,
      execution: "none",
      freshness: "unreachable",
      lastObservedAt: undefined,
      step: { status: "pending" },
      correlation: undefined,
      updatedAt: "Today 14:30",
    }),
  ),
  focusScenario(
    "unreachable-known",
    "Unreachable · last known",
    "Runtime offline after a good observation: last known state retained with an offline warning.",
    run({
      invocationId: "f3a8d2c6-0b95-4e71-8c3f-b9e4a1d07c58",
      freshness: "unreachable",
      lastObservedAt: "Today 14:24",
    }),
  ),
  focusScenario(
    "target-lost",
    "Target lost",
    "Absorbing state: final outcome unknown, no same-run retry, cancel unavailable.",
    run({
      invocationId: "2e9c5f8a-6d13-4b47-a0e8-c7f2d1b94e60",
      stateVersion: 7,
      desired: "cancelled",
      cancelRequestedAt: "Today 14:30",
      freshness: "target_lost",
      lastObservedAt: "Today 14:26",
    }),
  ),
  focusScenario(
    "session-unavailable",
    "Session unavailable",
    "Run history remains; the exact session no longer resolves, so Open session degrades safely.",
    run({
      invocationId: "d7b1e4a9-5c28-4f06-b3d9-a0c6f8e21d45",
      stateVersion: 8,
      execution: "completed",
      updatedAt: "Today 12:10",
      step: { status: "completed", startedAt: "Today 12:01", finishedAt: "Today 12:10" },
      sessionAvailability: "unavailable",
    }),
  ),
  focusScenario(
    "scratch-run",
    "Scratch placement",
    "No default repository: the run gets a scratch workspace, repository actions absent.",
    run({
      invocationId: "c4e7a2d8-9b36-4f15-80c2-e5d1b7a04f93",
      placement: { kind: "scratch" },
      arguments: { focus_area: "npm supply chain" },
    }),
    { definition: SCRATCH_DEFINITION },
  ),
];
