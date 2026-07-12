import type { PrototypeAgent, PrototypeGit } from "./PopoverPaneFixtures";

// Prototype-local projections shared by the aggregate popover and global
// agents pane. Production workspace activity owns its corresponding rules.

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
