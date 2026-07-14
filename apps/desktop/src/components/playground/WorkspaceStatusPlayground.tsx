import { useState, type ReactNode } from "react";
import {
  ProductSidebarBrandRow,
  ProductSidebarSectionHeader,
} from "@proliferate/product-ui/sidebar/ProductSidebarLayout";
import { RepoGroup, type RepoGroupEnvironmentKind } from "@/components/workspace/shell/sidebar/RepoGroup";
import { SidebarPrimaryNavigation } from "@/components/workspace/shell/sidebar/SidebarPrimaryNavigation";
import { SidebarRepositoriesHeader } from "@/components/workspace/shell/sidebar/SidebarRepositoriesHeader";
import { WorkspaceItem } from "@/components/workspace/shell/sidebar/WorkspaceItem";
import type { CloudSidebarStatus } from "@/config/cloud-sidebar";
import type {
  SidebarDetailIndicator,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
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
    label: "Open PR — plain branch glyph",
    name: "Passing feature",
    gitStatus: makeGitStatus(),
  },
  {
    label: "Draft PR — same plain glyph, state in tooltip",
    name: "Draft work",
    gitStatus: makeGitStatus({
      pr: { state: "draft", number: 809, url: "https://github.com/acme/repo/pull/809", checks: "pending", reviewDecision: "none" },
    }),
  },
  {
    label: "Failing checks — red issue dot",
    name: "Broken build",
    gitStatus: makeGitStatus({
      pr: { state: "open", number: 807, url: "https://github.com/acme/repo/pull/807", checks: "failing", reviewDecision: "none" },
      attention: "ci_failing",
    }),
  },
  {
    label: "Conflicts — red issue dot",
    name: "Rebase me",
    gitStatus: makeGitStatus({
      dirty: true,
      conflicted: true,
      attention: "conflicts",
      pr: { state: "open", number: 812, url: "https://github.com/acme/repo/pull/812", checks: "passing", reviewDecision: "none" },
    }),
  },
  {
    label: "Merged PR — purple merge glyph",
    name: "Shipped thing",
    gitStatus: makeGitStatus({
      pr: { state: "merged", number: 810, url: "https://github.com/acme/repo/pull/810", checks: "passing", reviewDecision: "approved" },
    }),
  },
  {
    label: "No PR — no glyph",
    name: "Local only",
    gitStatus: makeGitStatus({
      ahead: 2,
      dirty: true,
      pr: { state: "none", number: null, url: null, checks: "none", reviewDecision: "none" },
    }),
  },
  {
    label: "Working · spinner in right slot",
    name: "Agent running",
    gitStatus: makeGitStatus(),
    statusIndicator: { kind: "iterating", tooltip: "Agent is working" },
  },
  {
    label: "Waiting for input · right slot",
    name: "Needs a decision",
    gitStatus: makeGitStatus(),
    statusIndicator: { kind: "waiting_input", tooltip: "Waiting for your input" },
  },
  {
    label: "Error · right slot, beats unread dot",
    name: "Crashed run",
    gitStatus: makeGitStatus(),
    statusIndicator: { kind: "error", tooltip: "The agent hit an error" },
    needsReview: true,
  },
];

function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface SidebarFixtureRow {
  name: string;
  variant: SidebarWorkspaceVariant;
  gitStatus?: WorkspaceGitStatus | null;
  statusIndicator?: SidebarStatusIndicator | null;
  detailIndicators?: SidebarDetailIndicator[];
  cloudStatus?: CloudSidebarStatus | null;
  needsReview?: boolean;
  archived?: boolean;
  lastInteracted?: string | null;
}

interface SidebarFixtureGroup {
  name: string;
  kind: RepoGroupEnvironmentKind;
  rows: SidebarFixtureRow[];
}

/**
 * A realistic composed sidebar: one repo group per environment kind, rows
 * chosen so every status system is on screen at once — git/PR glyph tones,
 * right-slot activity indicators, cloud status chips, detail indicators,
 * unread dots, archived rows, and relative timestamps.
 */
const SIDEBAR_FIXTURE_GROUPS: SidebarFixtureGroup[] = [
  {
    name: "proliferate",
    kind: "local_cloud",
    rows: [
      {
        name: "Sidebar polish",
        variant: "worktree",
        gitStatus: makeGitStatus(),
        statusIndicator: { kind: "iterating", tooltip: "Agent is working" },
      },
      {
        name: "Fix flaky tests",
        variant: "worktree",
        gitStatus: makeGitStatus({
          pr: { state: "open", number: 806, url: "https://github.com/acme/repo/pull/806", checks: "pending", reviewDecision: "none" },
        }),
        lastInteracted: agoIso(35 * MINUTE),
      },
      {
        name: "Broken build",
        variant: "worktree",
        gitStatus: makeGitStatus({
          pr: { state: "open", number: 807, url: "https://github.com/acme/repo/pull/807", checks: "failing", reviewDecision: "none" },
          attention: "ci_failing",
        }),
        needsReview: true,
        lastInteracted: agoIso(2 * HOUR),
      },
      {
        name: "Rebase me",
        variant: "worktree",
        gitStatus: makeGitStatus({
          dirty: true,
          conflicted: true,
          attention: "conflicts",
          pr: { state: "open", number: 812, url: "https://github.com/acme/repo/pull/812", checks: "passing", reviewDecision: "none" },
        }),
        statusIndicator: { kind: "waiting_input", tooltip: "Waiting for your input" },
      },
      {
        name: "Repo checkout",
        variant: "local",
        gitStatus: makeGitStatus({
          dirty: true,
          ahead: 2,
          pr: { state: "none", number: null, url: null, checks: "none", reviewDecision: "none" },
        }),
        lastInteracted: agoIso(3 * DAY),
      },
    ],
  },
  {
    name: "landing",
    kind: "local",
    rows: [
      {
        name: "Hero rewrite",
        variant: "worktree",
        gitStatus: makeGitStatus({
          pr: { state: "merged", number: 810, url: "https://github.com/acme/repo/pull/810", checks: "passing", reviewDecision: "approved" },
        }),
        lastInteracted: agoIso(6 * DAY),
      },
      {
        name: "Pricing draft",
        variant: "worktree",
        gitStatus: makeGitStatus({
          pr: { state: "draft", number: 809, url: "https://github.com/acme/repo/pull/809", checks: "pending", reviewDecision: "none" },
        }),
        statusIndicator: { kind: "queued_prompt", tooltip: "Queued Home prompt" },
      },
      {
        name: "Crashed run",
        variant: "worktree",
        gitStatus: makeGitStatus(),
        statusIndicator: { kind: "error", tooltip: "The agent hit an error" },
        needsReview: true,
      },
      {
        name: "Old spike",
        variant: "worktree",
        archived: true,
        gitStatus: makeGitStatus({
          pr: { state: "closed", number: 811, url: "https://github.com/acme/repo/pull/811", checks: "none", reviewDecision: "none" },
        }),
        lastInteracted: agoIso(14 * DAY),
      },
    ],
  },
  {
    name: "cloud-api",
    kind: "cloud",
    rows: [
      {
        name: "Nightly triage",
        variant: "cloud",
        cloudStatus: "ready",
        gitStatus: makeGitStatus({
          pr: { state: "open", number: 820, url: "https://github.com/acme/repo/pull/820", checks: "passing", reviewDecision: "none" },
        }),
        detailIndicators: [
          { kind: "automation", tooltip: "Started by the nightly triage workflow" },
        ],
        statusIndicator: { kind: "iterating", tooltip: "Agent is working" },
      },
      {
        name: "Provisioning box",
        variant: "cloud",
        cloudStatus: "materializing",
        gitStatus: null,
      },
      {
        name: "Queued clone",
        variant: "cloud",
        cloudStatus: "pending",
        gitStatus: null,
        statusIndicator: { kind: "waiting_plan", tooltip: "Waiting for plan approval" },
      },
      {
        name: "Boot failed",
        variant: "cloud",
        cloudStatus: "error",
        gitStatus: null,
        needsReview: true,
      },
    ],
  },
];

const SIDEBAR_WIDTHS = [240, 280, 340, 400] as const;

function FullSidebarPane() {
  const [width, setWidth] = useState<number>(280);
  const [shortcutReveal, setShortcutReveal] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (name: string) =>
    setCollapsedGroups((state) => ({ ...state, [name]: !state[name] }));
  const allCollapsed = SIDEBAR_FIXTURE_GROUPS.every((group) => collapsedGroups[group.name]);

  let shortcutIndex = 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-ui-sm text-muted-foreground">
        <label className="flex items-center gap-1.5">
          Width
          <select
            className="rounded border border-border bg-card px-1 py-0.5 text-ui-sm text-foreground"
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
          >
            {SIDEBAR_WIDTHS.map((value) => (
              <option key={value} value={value}>{value}px</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={shortcutReveal}
            onChange={(event) => setShortcutReveal(event.target.checked)}
          />
          Shortcut reveal
        </label>
      </div>

      <div
        className="flex max-h-[820px] shrink-0 flex-col overflow-y-auto rounded-xl border border-border bg-sidebar pb-4"
        style={{ width }}
      >
        <ProductSidebarBrandRow label="Proliferate" />
        <SidebarPrimaryNavigation
          homeActive
          workspacesActive={false}
          workflowsActive={false}
          supportActive={false}
          onGoHome={() => {}}
          onGoWorkspaces={() => {}}
          onGoWorkflows={() => {}}
          onOpenSupport={() => {}}
          shortcutRevealVisible={shortcutReveal}
          shortcutLabels={{ newChat: "⌘N", support: "⌘?" }}
        />
        <div className="flex min-h-0 flex-col px-2">
          <SidebarRepositoriesHeader
            hasRepoGroups
            allRepoGroupsCollapsed={allCollapsed}
            filtersActive={false}
            workspaceTypes={["local", "worktree", "cloud", "ssh"]}
            onToggleAllRepoGroups={() => {
              const next = !allCollapsed;
              setCollapsedGroups(Object.fromEntries(
                SIDEBAR_FIXTURE_GROUPS.map((group) => [group.name, next]),
              ));
            }}
            onToggleWorkspaceType={() => {}}
            onAddRepo={() => {}}
          />
          {SIDEBAR_FIXTURE_GROUPS.map((group) => (
            <RepoGroup
              key={group.name}
              name={group.name}
              count={group.rows.length}
              collapsed={!!collapsedGroups[group.name]}
              environmentKind={group.kind}
              onToggleCollapsed={() => toggleGroup(group.name)}
              onNewWorkspace={() => {}}
              onNewLocalWorkspace={() => {}}
            >
              {group.rows.map((row) => {
                shortcutIndex += 1;
                return (
                  <WorkspaceItem
                    key={row.name}
                    name={row.name}
                    variant={row.variant}
                    branchName={row.gitStatus?.branch ?? null}
                    gitStatus={row.gitStatus ?? null}
                    statusIndicator={row.statusIndicator ?? null}
                    detailIndicators={row.detailIndicators ?? []}
                    cloudStatus={row.cloudStatus ?? null}
                    needsReview={row.needsReview}
                    archived={row.archived}
                    lastInteracted={row.lastInteracted ?? null}
                    shortcutLabel={shortcutIndex <= 9 ? `⌘${shortcutIndex}` : null}
                    shortcutRevealVisible={shortcutReveal}
                    onSelect={() => {}}
                    onOpenPullRequest={() => {}}
                    onMarkDone={() => {}}
                  />
                );
              })}
            </RepoGroup>
          ))}
          <ProductSidebarSectionHeader label="Threads" />
          <div className="px-2 pb-2 text-ui-sm text-sidebar-muted-foreground">No chats yet</div>
        </div>
      </div>
    </div>
  );
}



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
      <Section title="Full sidebar — composed states">
        <FullSidebarPane />
      </Section>
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
    </div>
  );
}
