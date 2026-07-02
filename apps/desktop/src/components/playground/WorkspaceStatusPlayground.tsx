import type { ReactNode } from "react";
import { PrStatusDot, prStatusTooltip, type PrStatusKind } from "@proliferate/product-ui/workspaces/PrStatusBadge";
import { WorkspaceItem } from "@/components/workspace/shell/sidebar/WorkspaceItem";
import type { SidebarStatusIndicator } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { WorkspaceGitStatus } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";

function makeGitStatus(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    branch: "feature/status-ui",
    dirty: false,
    conflicted: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    pr: {
      state: "open",
      number: 805,
      url: "https://github.com/acme/repo/pull/805",
      checks: "passing",
      reviewDecision: "none",
    },
    attention: "none",
    capturedAt: "2026-07-01T10:00:00.000Z",
    source: "live",
    ...overrides,
  };
}

interface ScenarioRow {
  label: string;
  name: string;
  gitStatus: WorkspaceGitStatus | null;
  statusIndicator?: SidebarStatusIndicator | null;
  needsReview?: boolean;
  branchName?: string;
}

const SCENARIOS: ScenarioRow[] = [
  {
    label: "Open PR · checks passing",
    name: "Passing feature",
    gitStatus: makeGitStatus(),
  },
  {
    label: "Open PR · checks pending",
    name: "Pending checks",
    gitStatus: makeGitStatus({
      pr: { state: "open", number: 806, url: "https://github.com/acme/repo/pull/806", checks: "pending", reviewDecision: "none" },
    }),
  },
  {
    label: "Open PR · CI failing (attention)",
    name: "Broken build",
    gitStatus: makeGitStatus({
      pr: { state: "open", number: 807, url: "https://github.com/acme/repo/pull/807", checks: "failing", reviewDecision: "none" },
      attention: "ci_failing",
    }),
  },
  {
    label: "Open PR · changes requested",
    name: "Review pushback",
    gitStatus: makeGitStatus({
      pr: { state: "open", number: 808, url: "https://github.com/acme/repo/pull/808", checks: "passing", reviewDecision: "changes_requested" },
      attention: "changes_requested",
    }),
    needsReview: true,
  },
  {
    label: "Draft PR",
    name: "Draft work",
    gitStatus: makeGitStatus({
      pr: { state: "draft", number: 809, url: "https://github.com/acme/repo/pull/809", checks: "pending", reviewDecision: "none" },
    }),
  },
  {
    label: "Merged PR",
    name: "Shipped thing",
    gitStatus: makeGitStatus({
      pr: { state: "merged", number: 810, url: "https://github.com/acme/repo/pull/810", checks: "passing", reviewDecision: "approved" },
    }),
  },
  {
    label: "Closed PR",
    name: "Abandoned spike",
    gitStatus: makeGitStatus({
      pr: { state: "closed", number: 811, url: "https://github.com/acme/repo/pull/811", checks: "none", reviewDecision: "none" },
    }),
  },
  {
    label: "Conflicts (attention) · destructive PR glyph",
    name: "Rebase me",
    gitStatus: makeGitStatus({
      dirty: true,
      conflicted: true,
      attention: "conflicts",
      pr: { state: "open", number: 812, url: "https://github.com/acme/repo/pull/812", checks: "passing", reviewDecision: "none" },
    }),
  },
  {
    label: "Conflicts · no PR — no leading glyph (unread dot only)",
    name: "Conflicted local",
    gitStatus: makeGitStatus({
      dirty: true,
      conflicted: true,
      attention: "conflicts",
      pr: { state: "none", number: null, url: null, checks: "none", reviewDecision: "none" },
    }),
    needsReview: true,
  },
  {
    label: "No PR (authoritative) — no leading icon",
    name: "Local only",
    gitStatus: makeGitStatus({
      ahead: 2,
      dirty: true,
      pr: { state: "none", number: null, url: null, checks: "none", reviewDecision: "none" },
    }),
  },
  {
    label: "PR data unavailable (degraded) — no leading icon",
    name: "Unknown hosting",
    gitStatus: makeGitStatus({ pr: null }),
  },
  {
    label: "Working · spinner in right slot",
    name: "Agent running",
    gitStatus: makeGitStatus({
      pr: { state: "open", number: 813, url: "https://github.com/acme/repo/pull/813", checks: "pending", reviewDecision: "none" },
    }),
    statusIndicator: { kind: "iterating", tooltip: "Agent is working" },
  },
  {
    label: "Waiting for input · right slot",
    name: "Needs a decision",
    gitStatus: makeGitStatus(),
    statusIndicator: { kind: "waiting_input", tooltip: "Waiting for your input" },
  },
  {
    label: "Waiting for plan approval · right slot",
    name: "Plan pending",
    gitStatus: makeGitStatus(),
    statusIndicator: { kind: "waiting_plan", tooltip: "Waiting for plan approval" },
  },
  {
    label: "Queued prompt · right slot",
    name: "Queued follow-up",
    gitStatus: makeGitStatus(),
    statusIndicator: { kind: "queued_prompt", tooltip: "Queued Home prompt" },
  },
  {
    label: "Error · right slot, beats unread dot",
    name: "Crashed run",
    gitStatus: makeGitStatus(),
    statusIndicator: { kind: "error", tooltip: "The agent hit an error" },
    needsReview: true,
  },
];

const BADGE_KINDS: PrStatusKind[] = [
  "open",
  "pending",
  "checks_failing",
  "changes_requested",
  "draft",
  "merged",
  "closed",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-base font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Dev-only gallery for the workspace git/PR status system: every
 * WorkspaceGitStatus permutation rendered through the real sidebar row, plus
 * the PrStatusBadge kinds. No live data — pure fixtures, so states that need
 * a real PR (merged, CI failing...) are reviewable at any time.
 *
 * Layout rules under test: the leading well carries the PR glyph + dot ONLY
 * for real PR states (no branch fallback, no icon for no-PR/degraded rows);
 * activity indicators (spinner/waiting/error) render in the row's RIGHT slot
 * where the relative timestamp used to live, beating the unread dot but
 * yielding to hover affordances.
 */
export function WorkspaceStatusPlayground() {
  return (
    <div className="flex h-full w-full gap-8 overflow-auto bg-background p-8 text-foreground">
      <Section title="Sidebar rows — status matrix">
        <div className="w-72 rounded-xl border border-border bg-sidebar p-2">
          {SCENARIOS.map((scenario) => (
            <div key={scenario.label} className="mb-3">
              <div className="mb-1 px-1 text-ui-sm text-faint">{scenario.label}</div>
              <WorkspaceItem
                name={scenario.name}
                variant="worktree"
                branchName={scenario.gitStatus?.branch ?? scenario.branchName ?? null}
                gitStatus={scenario.gitStatus}
                statusIndicator={scenario.statusIndicator ?? null}
                needsReview={scenario.needsReview}
                onSelect={() => {}}
                onOpenPullRequest={() => {}}
                onMarkDone={() => {}}
              />
            </div>
          ))}
        </div>
      </Section>
      <Section title="PrStatusDot kinds">
        <div className="flex w-72 flex-col gap-2 rounded-xl border border-border bg-card p-3">
          {BADGE_KINDS.map((kind) => (
            <div key={kind} className="flex items-center justify-between gap-3">
              <span className="text-ui-sm text-muted-foreground">{kind}</span>
              <span className="flex items-center gap-2">
                <PrStatusDot status={{ kind, number: 805 }} />
                <span className="text-ui-sm text-faint">{prStatusTooltip({ kind, number: 805 })}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
