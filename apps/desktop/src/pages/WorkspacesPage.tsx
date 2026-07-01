import { useMemo } from "react";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import { WorkspacesCommandList, type WorkspacesCommandGroupView } from "@proliferate/product-ui/workspaces/WorkspacesCommandList";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useWorkspaceSidebarState } from "@/hooks/workspaces/derived/use-workspace-sidebar-state";
import { useWorkspaceSidebarActions } from "@/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useAppCommandActionsContext } from "@/providers/AppCommandActionsProvider";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { formatSidebarRelativeTime } from "@/lib/domain/workspaces/display/workspace-display";
import type { SidebarGroupState } from "@/lib/domain/workspaces/sidebar/sidebar-model";

/**
 * Conductor-style Workspaces page (UX spec §3): cmdk filter-list with
 * recency-grouped rows. Reuses the sidebar's workspace selectors (same data
 * wiring as the main sidebar) — this surface is presentation only.
 *
 * PR status dots are supported by the row component but not rendered here:
 * no PR state is plumbed to workspace rows yet (see PrStatusBadge).
 */
export function WorkspacesPage() {
  const actions = useWorkspaceSidebarActions();
  const appCommands = useAppCommandActionsContext();
  const { cloudActive } = useCloudAvailabilityState();
  const { data: repoConfigs } = useRepositories(cloudActive);
  const { groups } = useWorkspaceSidebarState({
    showArchived: false,
    repoConfigs: repoConfigs?.repositories ?? [],
  });

  const commandGroups = useMemo(() => buildRecencyGroups(groups), [groups]);

  return (
    <MainSidebarPageShell>
      {/* pt-10 clears the 40px drag-region strip MainSidebarPageShell overlays. */}
      <div className="mx-auto flex h-full w-full max-w-3xl min-w-0 flex-col px-8 pt-10">
        <WorkspacesCommandList
          groups={commandGroups}
          onWorkspaceSelect={actions.handleSelectWorkspace}
          onCreate={() => appCommands.newWorktreeWorkspace.execute("palette")}
          createShortcutLabel={getShortcutDisplayLabel(SHORTCUTS.newDefault)}
        />
      </div>
    </MainSidebarPageShell>
  );
}

interface RecencyBucket {
  id: string;
  label: string;
  maxAgeMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RECENCY_BUCKETS: RecencyBucket[] = [
  { id: "today", label: "Today", maxAgeMs: DAY_MS },
  { id: "yesterday", label: "Yesterday", maxAgeMs: 2 * DAY_MS },
  { id: "this-week", label: "This week", maxAgeMs: 7 * DAY_MS },
  { id: "this-month", label: "This month", maxAgeMs: 30 * DAY_MS },
  { id: "older", label: "Older", maxAgeMs: Number.POSITIVE_INFINITY },
];

function buildRecencyGroups(
  groups: SidebarGroupState[],
): WorkspacesCommandGroupView[] {
  const now = Date.now();
  const buckets = new Map<string, WorkspacesCommandGroupView>();

  const flattened = groups.flatMap((group) =>
    group.items.map((item) => ({ repoName: group.name, item })),
  ).sort((left, right) => timestamp(right.item.lastInteracted) - timestamp(left.item.lastInteracted));

  for (const { repoName, item } of flattened) {
    const age = now - timestamp(item.lastInteracted);
    const bucket = RECENCY_BUCKETS.find((candidate) => age < candidate.maxAgeMs)
      ?? RECENCY_BUCKETS[RECENCY_BUCKETS.length - 1];
    const existing = buckets.get(bucket.id);
    const row = {
      id: item.id,
      title: item.name,
      branch: item.branchName,
      meta: repoName,
      updatedLabel: item.lastInteracted
        ? formatSidebarRelativeTime(item.lastInteracted)
        : null,
    };
    if (existing) {
      existing.items.push(row);
    } else {
      buckets.set(bucket.id, { id: bucket.id, label: bucket.label, items: [row] });
    }
  }

  return RECENCY_BUCKETS
    .map((bucket) => buckets.get(bucket.id))
    .filter((group): group is WorkspacesCommandGroupView => Boolean(group));
}

function timestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
