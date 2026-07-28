import type { ReactNode } from "react";
import { WorkspacesCommandList } from "@proliferate/ui";

/**
 * The Conductor-style workspaces page: a cmdk filter list, not a table. `Command`
 * is `h-full w-full flex-col`, so the list collapses without a bounded parent —
 * every cell supplies the page column the route normally gives it.
 */
function Page({ children }: { children: ReactNode }) {
  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border"
      style={{ height: 600 }}
    >
      {children}
    </div>
  );
}

const GROUPS = [
  {
    id: "today",
    label: "Today",
    items: [
      {
        id: "ws-1",
        title: "session-activity",
        branch: "feature/session-activity",
        meta: "proliferate/anyharness",
        updatedLabel: "4m",
        running: true,
        aheadBehindLabel: "↑3 ↓1",
      },
      {
        id: "ws-2",
        title: "workflow-runs",
        branch: "feature/managed-runs",
        meta: "proliferate/anyharness",
        updatedLabel: "1h",
        prStatus: { kind: "open", number: 805 },
        prNumberLabel: "#805",
        aheadBehindLabel: "↑2",
      },
      {
        id: "ws-3",
        title: "secrets-pane",
        branch: "fix/secrets-pane",
        meta: "proliferate/proliferate-web",
        updatedLabel: "3h",
        prStatus: { kind: "checks_failing", number: 798 },
        prNumberLabel: "#798",
        attention: "conflicts",
      },
    ],
  },
  {
    id: "yesterday",
    label: "Yesterday",
    items: [
      {
        id: "ws-4",
        title: "docs-refresh",
        branch: "docs/agent-catalog",
        meta: "proliferate/docs",
        updatedLabel: "1d",
        prStatus: { kind: "merged", number: 771 },
        prNumberLabel: "#771",
      },
      {
        id: "ws-5",
        title: "scratch-repro",
        branch: null,
        meta: "scratch workspace",
        updatedLabel: "1d",
      },
    ],
  },
  {
    id: "this-week",
    label: "This week",
    items: [
      {
        id: "ws-6",
        title: "catalog-bump",
        branch: "chore/catalog-2026-07",
        meta: "proliferate/anyharness",
        updatedLabel: "4d",
        prStatus: { kind: "draft", number: 742 },
        prNumberLabel: "#742",
        aheadBehindLabel: "↓6",
      },
      {
        id: "ws-7",
        title: "pty-reconnect",
        branch: "fix/pty-reconnect",
        meta: "proliferate/anyharness · sess-4471",
        updatedLabel: "6d",
        prStatus: { kind: "changes_requested", number: 729 },
        prNumberLabel: "#729",
      },
    ],
  },
];

export const RecencyGroups = () => (
  <Page>
    <WorkspacesCommandList groups={GROUPS} onWorkspaceSelect={() => undefined} />
  </Page>
);

export const WithCreateRow = () => (
  <Page>
    <WorkspacesCommandList
      groups={GROUPS.slice(0, 2)}
      onWorkspaceSelect={() => undefined}
      onCreate={() => undefined}
      createShortcutLabel="⌘N"
    />
  </Page>
);

export const WithFilterRowAction = () => (
  <Page>
    <WorkspacesCommandList
      groups={GROUPS.slice(0, 1)}
      filterPlaceholder="Filter workspaces..."
      filterRowActions={
        <span className="block max-w-56 truncate text-ui-sm text-faint">
          PR status unavailable — gh not signed in
        </span>
      }
      onWorkspaceSelect={() => undefined}
      onCreate={() => undefined}
    />
  </Page>
);

export const NoWorkspaces = () => (
  <Page>
    <WorkspacesCommandList
      groups={[]}
      emptyLabel="No workspaces yet"
      onCreate={() => undefined}
    />
  </Page>
);
