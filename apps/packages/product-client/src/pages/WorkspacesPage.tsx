import { useMemo } from "react";
import { useRepositories } from "@proliferate/cloud-sdk-react";
import {
  WorkspacesCommandList,
  type WorkspacesCommandGroupView,
  type WorkspacesCommandItemView,
} from "#product/components/workspace/repo-setup/WorkspacesCommandList";
import { Tooltip } from "#product/primitives/Tooltip";
import { MainSidebarPageShell } from "#product/components/workspace/shell/screen/MainSidebarPageShell";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useWorkspaceGitStatuses } from "#product/hooks/workspaces/derived/use-workspace-git-statuses";
import { useWorkspaceSidebarState } from "#product/hooks/workspaces/derived/use-workspace-sidebar-state";
import { useWorkspaceSidebarActions } from "#product/hooks/workspaces/workflows/use-workspace-sidebar-actions";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import { formatSidebarRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";
import {
  gitAheadBehindLabel,
  prNumberLabelFromGitStatus,
  prStatusViewFromGitStatus,
} from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { SidebarGroupState, SidebarWorkspaceItemState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";

const PR_STATUS_UNAVAILABLE_LABEL = "PR status unavailable — gh not signed in";

/**
 * The Workspaces page (UX spec §3): cmdk filter-list with recency-grouped
 * rows. Reuses the sidebar's workspace selectors (same data wiring as the main
 * sidebar) — this surface is presentation only. Git/PR state comes from
 * `useWorkspaceGitStatuses`, keyed by the same logical workspace id the
 * sidebar items carry.
 *
 * Every row detail is projected from data the sidebar state already holds; the
 * page adds no query of its own.
 */
export function WorkspacesPage() {
  const actions = useWorkspaceSidebarActions();
  const { cloudActive, cloudComputeEnabled } = useCloudAvailabilityState();
  const { data: repoConfigs } = useRepositories(cloudActive);
  const { groups } = useWorkspaceSidebarState({
    showArchived: false,
    repoConfigs: repoConfigs?.repositories ?? [],
    cloudComputeEnabled,
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
      {/*
        max-w-5xl + px-10 is the standard wide full-page measure and gutter in
        this app: it is what PageContentFrame is given by every other full-page
        product surface (the workflows definition list, run detail, resource
        state, and the workflows access screen all pass maxWidthClassName
        max-w-5xl, and PageContentFrame's own gutter is px-10). This page keeps
        its own frame instead of PageContentFrame because the command list owns
        its scroll container, so the measure is matched by hand.
        pt-10 clears the 40px drag-region strip MainSidebarPageShell overlays.
      */}
      <div className="mx-auto flex h-full w-full max-w-5xl min-w-0 flex-col px-10 pt-10">
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
          onCreate={actions.handleStartWorktreeWorkspaceCreation}
          createShortcutLabel={getShortcutDisplayLabel(SHORTCUTS.newWorktree)}
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
      sessionCount: item.sessionCount,
      placementLabel: placementLabelForVariant(item.variant),
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

/**
 * Only non-local placement earns a badge. A local worktree is the default and
 * labelling it would mark every row with the same word.
 */
function placementLabelForVariant(
  variant: SidebarWorkspaceItemState["variant"],
): string | null {
  switch (variant) {
    case "cloud":
      return "Cloud";
    case "local":
    case "worktree":
      return null;
  }
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
