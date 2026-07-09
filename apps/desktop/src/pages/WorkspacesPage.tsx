import { useMemo } from "react";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import {
  WorkspacesCommandList,
  type WorkspacesCommandGroupView,
  type WorkspacesCommandItemView,
} from "@proliferate/product-ui/workspaces/WorkspacesCommandList";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useWorkspaceGitStatuses } from "@/hooks/workspaces/derived/use-workspace-git-statuses";
import { useWorkspaceSidebarState } from "@/hooks/workspaces/derived/use-workspace-sidebar-state";
import { useWorkspaceSidebarActions } from "@/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { useAppCommandActionsContext } from "@/providers/AppCommandActionsProvider";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { formatSidebarRelativeTime } from "@/lib/domain/workspaces/display/workspace-display";
import {
  gitAheadBehindLabel,
  prNumberLabelFromGitStatus,
  prStatusViewFromGitStatus,
} from "@/lib/domain/workspaces/git-status/pr-status-presentation";
import type { SidebarGroupState, SidebarWorkspaceItemState } from "@/lib/domain/workspaces/sidebar/sidebar-model";

const PR_STATUS_UNAVAILABLE_LABEL = "PR status unavailable — gh not signed in";

/**
 * Conductor-style Workspaces page (UX spec §3): cmdk filter-list with
 * recency-grouped rows. Reuses the sidebar's workspace selectors (same data
 * wiring as the main sidebar) — this surface is presentation only. Git/PR
 * state comes from `useWorkspaceGitStatuses`, keyed by the same logical
 * workspace id the sidebar items carry.
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
  // Row git/PR state rides on item.gitStatus (fed by the same hook inside
  // the sidebar state); the page only needs the sync map for the §4.4 note.
  const { syncByLogicalId } = useWorkspaceGitStatuses();

  const commandGroups = useMemo(() => buildRecencyGroups(groups), [groups]);

  // §4.4: only gh_auth_required surfaces a note (not-installed and
  // remote-unsupported stay silent); it disappears once auth resolves.
  const ghAuthRequired = useMemo(
    () => Object.values(syncByLogicalId).some(
      (sync) => sync.availability === "gh_auth_required",
    ),
    [syncByLogicalId],
  );

  return (
    <MainSidebarPageShell>
      {/* pt-10 clears the 40px drag-region strip MainSidebarPageShell overlays. */}
      <div className="mx-auto flex h-full w-full max-w-3xl min-w-0 flex-col px-8 pt-10">
        <WorkspacesCommandList
          groups={commandGroups}
          filterRowActions={ghAuthRequired ? (
            <Tooltip content={PR_STATUS_UNAVAILABLE_LABEL}>
              <span className="block max-w-56 truncate text-ui-sm text-faint">
                {PR_STATUS_UNAVAILABLE_LABEL}
              </span>
            </Tooltip>
          ) : null}
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
    // Missing git status degrades to a plain branch row.
    const gitStatus = item.gitStatus;
    const row: WorkspacesCommandItemView = {
      id: item.id,
      title: item.name,
      branch: item.branchName,
      meta: repoName,
      updatedLabel: item.lastInteracted
        ? formatSidebarRelativeTime(item.lastInteracted)
        : null,
      prStatus: prStatusViewFromGitStatus(gitStatus),
      running: isRunningIndicator(item),
      attention: gitStatus?.attention === "conflicts" ? "conflicts" : null,
      aheadBehindLabel: gitAheadBehindLabel(gitStatus),
      prNumberLabel: prNumberLabelFromGitStatus(gitStatus),
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

function isRunningIndicator(item: SidebarWorkspaceItemState): boolean {
  const kind = item.statusIndicator?.kind;
  return kind === "iterating" || kind === "queued_prompt";
}

function timestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
