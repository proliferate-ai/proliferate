import { useState, type ReactNode } from "react";
import { WorkspaceInventory } from "@proliferate/ui";

/**
 * The grouped workspace inventory used by the Cloud work surface. Rows carry a
 * source glyph, source / target / branch metadata cells and a status column,
 * and the group header is a real toggle only when `onGroupToggle` is supplied —
 * which is what the Collapsible cell drives from state.
 */
function Pane({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full overflow-auto rounded-lg border border-border px-3"
      style={{ height: 600 }}
    >
      {children}
    </div>
  );
}

function item(overrides) {
  return {
    id: "ws-1",
    title: "session-activity",
    description: null,
    repoLabel: "proliferate/anyharness",
    branchLabel: "feature/session-activity",
    sourceKind: "desktop_exposed",
    sourceLabel: "Desktop",
    locationKind: "worktree",
    locationLabel: "Worktree",
    runtimeLocation: "local",
    runtimeLocationLabel: "This Mac",
    cloudAccessState: "not_exposed",
    cloudAccessLabel: "",
    commandability: "commandable",
    commandabilityLabel: "",
    scopeLabel: null,
    statusKind: "working",
    statusLabel: "Working",
    ownershipKind: "mine",
    ownerLabel: "You",
    exposureLabel: null,
    sessionLabel: null,
    updatedLabel: "4m",
    active: false,
    ...overrides,
  };
}

const GROUPS = [
  {
    id: "mine",
    label: "Mine",
    count: 3,
    statusKind: "working",
    items: [
      item({ id: "ws-1", active: true }),
      item({
        id: "ws-2",
        title: "workflow-runs",
        branchLabel: "feature/managed-runs",
        sourceKind: "cloud_sandbox",
        sourceLabel: "Cloud",
        locationKind: "managed_personal",
        locationLabel: "Managed sandbox",
        runtimeLocationLabel: "Cloud",
        cloudAccessLabel: "Exposed",
        statusKind: "review",
        statusLabel: "In review",
        sessionLabel: "sess-4471",
        updatedLabel: "1h",
      }),
      item({
        id: "ws-3",
        title: "secrets-pane",
        repoLabel: "proliferate/proliferate-web",
        branchLabel: "fix/secrets-pane",
        statusKind: "blocked",
        statusLabel: "Blocked",
        commandabilityLabel: "Needs reconnect",
        updatedLabel: "3h",
      }),
    ],
  },
  {
    id: "unclaimed",
    label: "Unclaimed",
    count: 2,
    statusKind: "waiting",
    items: [
      item({
        id: "ws-4",
        title: "nightly-dep-sweep",
        repoLabel: "proliferate/anyharness",
        branchLabel: "chore/dep-sweep",
        sourceKind: "personal_automation",
        sourceLabel: "Schedule",
        locationKind: "cloud",
        locationLabel: "Cloud",
        runtimeLocationLabel: "Cloud",
        statusKind: "waiting",
        statusLabel: "Waiting",
        ownershipKind: "unclaimed",
        ownerLabel: "Unclaimed",
        updatedLabel: "12h",
      }),
      item({
        id: "ws-5",
        title: "triage-PROL-1284",
        repoLabel: "proliferate/anyharness",
        branchLabel: null,
        sourceKind: "slack",
        sourceLabel: "Slack",
        locationKind: "session",
        locationLabel: "Session",
        runtimeLocationLabel: "Cloud",
        statusKind: "done",
        statusLabel: "Done",
        ownershipKind: "unclaimed",
        ownerLabel: "Unclaimed",
        updatedLabel: "1d",
      }),
    ],
  },
  {
    id: "team",
    label: "Team",
    count: 1,
    statusKind: "done",
    suppressOwnerLabel: true,
    items: [
      item({
        id: "ws-6",
        title: "release-2026-07",
        repoLabel: "proliferate/docs",
        branchLabel: "release/2026-07",
        sourceKind: "team_automation",
        sourceLabel: "Automation",
        locationKind: "managed_shared",
        locationLabel: "Shared sandbox",
        runtimeLocationLabel: "Cloud",
        cloudAccessLabel: "Shared",
        statusKind: "done",
        statusLabel: "Done",
        ownershipKind: "team",
        ownerLabel: "Docs team",
        updatedLabel: "2d",
      }),
    ],
  },
];

export const GroupedInventory = () => (
  <Pane>
    <WorkspaceInventory groups={GROUPS} onWorkspaceSelect={() => undefined} />
  </Pane>
);

export const CollapsibleGroups = () => {
  const [collapsed, setCollapsed] = useState({ unclaimed: true });
  return (
    <Pane>
      <WorkspaceInventory
        groups={GROUPS.map((group) => ({
          ...group,
          collapsed: Boolean(collapsed[group.id]),
        }))}
        onGroupToggle={(groupId) =>
          setCollapsed((current) => ({ ...current, [groupId]: !current[groupId] }))
        }
        onWorkspaceSelect={() => undefined}
      />
    </Pane>
  );
};

export const Loading = () => (
  <Pane>
    <WorkspaceInventory groups={[]} loading />
  </Pane>
);

export const NoWorkspaces = () => (
  <Pane>
    <WorkspaceInventory
      groups={[]}
      emptyTitle="No cloud workspaces"
      emptyDescription="Start a run or expose a local worktree and it will appear here."
    />
  </Pane>
);

export const LoadFailed = () => (
  <Pane>
    <WorkspaceInventory groups={[]} error />
  </Pane>
);
