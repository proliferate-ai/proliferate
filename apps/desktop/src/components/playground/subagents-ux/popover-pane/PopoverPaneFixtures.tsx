// Fixture data + pure aggregate helpers for the popover/pane prototype lane.
// Prototype-local on purpose: this lane must not touch the shared playground
// fixture tree while the visual direction is still being explored.

export type PopoverPaneScenarioKey =
  | "no-agents"
  | "multiple-running"
  | "mixed-states"
  | "failures"
  | "overflow";

export type PrototypeAgentStatus =
  | "starting"
  | "running"
  | "idle"
  | "completed"
  | "errored"
  | "closed";

export interface PrototypeAgent {
  id: string;
  /** Task-named label — the serious name in the pane. */
  label: string;
  harness: string;
  status: PrototypeAgentStatus;
  wakeScheduled: boolean;
  /** Secondary status line, already composed ("Working · 4m"). */
  detail: string;
}

export interface PrototypeGit {
  branch: string;
  changedFiles: number;
  stagedFiles: number;
  ahead: number;
  behind: number;
  conflictedFiles: number;
  pullRequestLabel: string | null;
}

export interface PopoverPaneScenario {
  key: PopoverPaneScenarioKey;
  label: string;
  parentTitle: string;
  git: PrototypeGit;
  agents: PrototypeAgent[];
  closedAgents: PrototypeAgent[];
}

const BASE_GIT: PrototypeGit = {
  branch: "feat/workspace-activity",
  changedFiles: 6,
  stagedFiles: 2,
  ahead: 2,
  behind: 0,
  conflictedFiles: 0,
  pullRequestLabel: "PR #1042 · Open · Checks passing",
};

const OVERFLOW_TASKS = [
  "API Surface Check",
  "SDK Types Sync",
  "Migration Dry Run",
  "Flaky Test Hunt",
  "Changelog Draft",
  "Perf Trace Sweep",
  "Docs Truth Pass",
  "Repo Shape Audit",
  "Fixture Backfill",
  "Telemetry Mask Review",
  "Catalog Probe",
  "Release Notes Draft",
  "Contract Diff Check",
  "Query Key Census",
] as const;

function overflowAgents(): PrototypeAgent[] {
  return OVERFLOW_TASKS.map((label, index) => {
    const status: PrototypeAgentStatus = index === 3
      ? "errored"
      : index === 9
        ? "starting"
        : index % 3 === 0
          ? "running"
          : index % 3 === 1
            ? "idle"
            : "completed";
    return {
      id: `overflow-${index}-${label.toLowerCase().replace(/\s+/gu, "-")}`,
      label,
      harness: index % 2 === 0 ? "Claude" : "Codex",
      status,
      wakeScheduled: index % 4 === 1,
      detail: status === "errored"
        ? "Failed · tool error"
        : status === "starting"
          ? "Starting"
          : status === "running"
            ? `Working · ${3 + index}m`
            : status === "idle"
              ? "Idle · Completed turn"
              : "Done · Completed turn",
    };
  });
}

export const POPOVER_PANE_SCENARIOS: readonly PopoverPaneScenario[] = [
  {
    key: "no-agents",
    label: "No agents",
    parentTitle: "Ship workspace activity",
    git: { ...BASE_GIT, changedFiles: 0, stagedFiles: 0, ahead: 0, pullRequestLabel: null },
    agents: [],
    closedAgents: [],
  },
  {
    key: "multiple-running",
    label: "Multiple running",
    parentTitle: "Ship workspace activity",
    git: BASE_GIT,
    agents: [
      {
        id: "run-api-surface",
        label: "API Surface Check",
        harness: "Claude",
        status: "running",
        wakeScheduled: false,
        detail: "Working · 4m",
      },
      {
        id: "run-sdk-types",
        label: "SDK Types Sync",
        harness: "Codex",
        status: "running",
        wakeScheduled: false,
        detail: "Working · 2m",
      },
      {
        id: "run-migration-dry",
        label: "Migration Dry Run",
        harness: "Claude",
        status: "running",
        wakeScheduled: true,
        detail: "Working · Wake scheduled",
      },
      {
        id: "run-perf-trace",
        label: "Perf Trace Sweep",
        harness: "Codex",
        status: "starting",
        wakeScheduled: false,
        detail: "Starting",
      },
    ],
    closedAgents: [],
  },
  {
    key: "mixed-states",
    label: "Mixed states",
    parentTitle: "Ship workspace activity",
    git: BASE_GIT,
    agents: [
      {
        id: "mix-api-surface",
        label: "API Surface Check",
        harness: "Claude",
        status: "starting",
        wakeScheduled: false,
        detail: "Starting",
      },
      {
        id: "mix-flaky-tests",
        label: "Flaky Test Hunt",
        harness: "Codex",
        status: "errored",
        wakeScheduled: false,
        detail: "Failed · tool error",
      },
      {
        id: "mix-sdk-types",
        label: "SDK Types Sync",
        harness: "Claude",
        status: "running",
        wakeScheduled: false,
        detail: "Working · 6m",
      },
      {
        id: "mix-migration-dry",
        label: "Migration Dry Run",
        harness: "Codex",
        status: "idle",
        wakeScheduled: true,
        detail: "Idle · Wake scheduled",
      },
      {
        id: "mix-changelog",
        label: "Changelog Draft",
        harness: "Claude",
        status: "completed",
        wakeScheduled: false,
        detail: "Done · Completed turn",
      },
      {
        id: "mix-docs-pass",
        label: "Docs Truth Pass",
        harness: "Codex",
        status: "completed",
        wakeScheduled: false,
        detail: "Done · Completed turn",
      },
    ],
    closedAgents: [
      {
        id: "mix-closed-repo-shape",
        label: "Repo Shape Audit",
        harness: "Claude",
        status: "closed",
        wakeScheduled: false,
        detail: "Closed · Yesterday",
      },
      {
        id: "mix-closed-fixture",
        label: "Fixture Backfill",
        harness: "Codex",
        status: "closed",
        wakeScheduled: false,
        detail: "Closed · 2 days ago",
      },
    ],
  },
  {
    key: "failures",
    label: "Failures",
    parentTitle: "Ship workspace activity",
    git: { ...BASE_GIT, conflictedFiles: 1 },
    agents: [
      {
        id: "fail-flaky-tests",
        label: "Flaky Test Hunt",
        harness: "Codex",
        status: "errored",
        wakeScheduled: false,
        detail: "Failed · exit 1",
      },
      {
        id: "fail-catalog-probe",
        label: "Catalog Probe",
        harness: "Claude",
        status: "errored",
        wakeScheduled: false,
        detail: "Failed · sandbox lost",
      },
      {
        id: "fail-api-surface",
        label: "API Surface Check",
        harness: "Claude",
        status: "starting",
        wakeScheduled: false,
        detail: "Starting",
      },
      {
        id: "fail-sdk-types",
        label: "SDK Types Sync",
        harness: "Codex",
        status: "running",
        wakeScheduled: false,
        detail: "Working · 1m",
      },
    ],
    closedAgents: [],
  },
  {
    key: "overflow",
    label: "Overflow",
    parentTitle: "Ship workspace activity",
    git: BASE_GIT,
    agents: overflowAgents(),
    closedAgents: [
      {
        id: "overflow-closed-release",
        label: "Release Dry Run",
        harness: "Claude",
        status: "closed",
        wakeScheduled: false,
        detail: "Closed · Yesterday",
      },
      {
        id: "overflow-closed-seed",
        label: "Seed Script Repair",
        harness: "Codex",
        status: "closed",
        wakeScheduled: false,
        detail: "Closed · 3 days ago",
      },
      {
        id: "overflow-closed-lint",
        label: "Lint Debt Sweep",
        harness: "Claude",
        status: "closed",
        wakeScheduled: false,
        detail: "Closed · Last week",
      },
    ],
  },
];

export function resolvePopoverPaneScenario(key: PopoverPaneScenarioKey): PopoverPaneScenario {
  return POPOVER_PANE_SCENARIOS.find((scenario) => scenario.key === key)
    ?? POPOVER_PANE_SCENARIOS[0];
}

export interface SubagentAggregate {
  total: number;
  working: number;
  idle: number;
  wakeScheduled: number;
  failed: number;
  done: number;
}

export function buildSubagentAggregate(agents: readonly PrototypeAgent[]): SubagentAggregate {
  return {
    total: agents.length,
    working: agents.filter((agent) => agent.status === "running" || agent.status === "starting").length,
    idle: agents.filter((agent) => agent.status === "idle").length,
    wakeScheduled: agents.filter((agent) => agent.wakeScheduled).length,
    failed: agents.filter((agent) => agent.status === "errored").length,
    done: agents.filter((agent) => agent.status === "completed").length,
  };
}

export type ActivityFactTone = "default" | "attention" | "destructive";

export interface ActivityFact {
  key: string;
  label: string;
  tone: ActivityFactTone;
}

// Fact ordering mirrors buildSummaryFacts in
// lib/domain/workspaces/activity/composer-workspace-activity.ts: attention
// first, then active agents, actionable git state, then the healthy fallback.
export function buildActivityFacts(
  git: PrototypeGit,
  aggregate: SubagentAggregate,
): ActivityFact[] {
  const facts: ActivityFact[] = [];
  if (git.conflictedFiles > 0) {
    facts.push({
      key: "conflicts",
      label: `${git.conflictedFiles} ${git.conflictedFiles === 1 ? "conflict" : "conflicts"}`,
      tone: "destructive",
    });
  }
  if (aggregate.failed > 0) {
    facts.push({
      key: "agents-failed",
      label: `${aggregate.failed} ${aggregate.failed === 1 ? "agent failed" : "agents failed"}`,
      tone: "destructive",
    });
  }
  const workingCount = aggregate.working;
  if (workingCount > 0) {
    facts.push({
      key: "agents-working",
      label: `${workingCount} ${workingCount === 1 ? "agent working" : "agents working"}`,
      tone: "default",
    });
  }
  if (git.ahead > 0 || git.behind > 0) {
    const parts = [
      git.ahead > 0 ? `${git.ahead} ahead` : null,
      git.behind > 0 ? `${git.behind} behind` : null,
    ].filter((part): part is string => part !== null);
    facts.push({ key: "sync", label: parts.join(" · "), tone: "default" });
  }
  if (git.changedFiles > 0) {
    facts.push({
      key: "changes",
      label: `${git.changedFiles} ${git.changedFiles === 1 ? "change" : "changes"}`,
      tone: "default",
    });
  }
  if (git.pullRequestLabel) {
    facts.push({ key: "pull-request", label: pullRequestSummary(git.pullRequestLabel), tone: "default" });
  }
  if (facts.length === 0) {
    facts.push({ key: "branch", label: git.branch, tone: "default" });
    facts.push({ key: "clean", label: "No changes", tone: "default" });
  }
  return facts;
}

export function subagentCountsLine(aggregate: SubagentAggregate): string | null {
  const parts = [
    aggregate.failed > 0 ? `${aggregate.failed} failed` : null,
    aggregate.working > 0 ? `${aggregate.working} working` : null,
    aggregate.idle > 0 ? `${aggregate.idle} idle` : null,
    aggregate.done > 0 ? `${aggregate.done} done` : null,
  ].filter((part): part is string => part !== null);
  return parts.slice(0, 3).join(" · ") || null;
}

function pullRequestSummary(label: string): string {
  const parts = label.split("·").map((part) => part.trim()).filter(Boolean);
  const identity = parts[0] ?? label;
  const checks = parts.find((part) => /^checks\s+/iu.test(part));
  return checks
    ? `${identity} ${checks.replace(/^checks\s+/iu, "").toLowerCase()}`
    : identity;
}
