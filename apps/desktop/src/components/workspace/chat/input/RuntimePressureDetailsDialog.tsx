import { useMemo, useState } from "react";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import type {
  RuntimePressureTargetState,
  useRuntimePressureControlState,
} from "@/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { worktreeRowSearchText } from "@/lib/domain/workspaces/worktrees/worktree-inventory-presentation";
import {
  EmptyWorktreeState,
  RuntimeWorktreeRow,
  WorktreeFilterMenu,
  WorktreeSortMenu,
  WorktreeTableHeader,
  compareWorktreeRows,
  formatByteEstimate,
  repoLabelFromPath,
  rowStatusFilter,
  summarizeStorage,
  type WorktreeSortKey,
  type WorktreeStatusFilter,
} from "./RuntimePressureWorktreeTable";

export function RuntimePressureDetailsDialog({
  open,
  targetState,
  actions,
  onClose,
}: {
  open: boolean;
  targetState: RuntimePressureTargetState;
  actions: ReturnType<typeof useRuntimePressureControlState>["actions"];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{
    workspaceId: string;
    label: string;
  } | null>(null);
  const [repoFilter, setRepoFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<WorktreeStatusFilter>("all");
  const [sort, setSort] = useState<WorktreeSortKey>("size");

  const repoOptions = useMemo(() => {
    const values = new Set<string>();
    for (const row of targetState.inventory) {
      values.add(row.repoRootName ?? repoLabelFromPath(row.path));
    }
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [targetState.inventory]);

  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = targetState.inventory.filter((row) => {
      if (needle && !worktreeRowSearchText(row).includes(needle)) {
        return false;
      }
      if (repoFilter !== "all" && (row.repoRootName ?? repoLabelFromPath(row.path)) !== repoFilter) {
        return false;
      }
      if (statusFilter !== "all" && rowStatusFilter(row) !== statusFilter) {
        return false;
      }
      return true;
    });
    return [...rows].sort((left, right) => compareWorktreeRows(left, right, sort));
  }, [filter, repoFilter, sort, statusFilter, targetState.inventory]);

  const storageSummary = summarizeStorage(visibleRows);
  const summary = worktreesSummary(targetState, repoFilter);

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        title="Worktrees"
        description={summary}
        headerContent={(
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-medium tracking-tight text-foreground">Worktrees</h2>
            <p className="truncate text-ui-sm text-muted-foreground">{summary}</p>
          </div>
        )}
        sizeClassName="max-w-[760px] max-h-[84vh]"
        panelClassName="border-0 ring-[0.5px] ring-popover-ring shadow-popover"
        bodyClassName="flex min-h-0 flex-col px-0 pb-0 pt-0"
        footerClassName="flex shrink-0 flex-col gap-2 border-t border-border/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
        footer={(
          <>
            <p className="min-w-0 text-ui-sm text-muted-foreground">
              Delete removes the selected checkout and any attached runtime history.
            </p>
            <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground">
              {formatByteEstimate(storageSummary.worktreeBytes, true)} checkout + {formatByteEstimate(storageSummary.sqliteBytes, true)} logs
            </span>
          </>
        )}
      >
        <div className="flex items-center gap-2 border-b border-border/60 py-1 pl-2.5 pr-4">
          <div className="min-w-0 flex-1">
            <PopoverSearchField
              value={filter}
              onChange={setFilter}
              placeholder="Filter by name, branch..."
            />
          </div>
          <WorktreeFilterMenu
            repoOptions={repoOptions}
            repoFilter={repoFilter}
            statusFilter={statusFilter}
            onRepoFilterChange={setRepoFilter}
            onStatusFilterChange={setStatusFilter}
          />
          <WorktreeSortMenu sort={sort} onSortChange={setSort} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <WorktreeTableHeader />
          {targetState.inventoryLoading ? (
            <EmptyWorktreeState label="Loading worktrees..." />
          ) : targetState.inventoryError ? (
            <EmptyWorktreeState label="Runtime inventory is unavailable." />
          ) : visibleRows.length === 0 ? (
            <EmptyWorktreeState label={targetState.inventory.length === 0 ? "No worktrees found." : "No worktrees match the filter."} />
          ) : (
            <div>
              {visibleRows.map((row) => (
                <RuntimeWorktreeRow
                  key={row.id}
                  row={row}
                  onDeleteOrphan={(path) => actions.pruneOrphan(targetState.target, { path })}
                  onPurgeWorkspace={(workspaceId, label) => setConfirmDelete({ workspaceId, label })}
                />
              ))}
            </div>
          )}
        </div>
      </ModalShell>
      <ConfirmationDialog
        open={confirmDelete !== null}
        title={`Delete runtime history for ${confirmDelete?.label ?? "this workspace"}?`}
        description="This permanently deletes the AnyHarness runtime workspace record, chats, raw events, normalized events, checkout, and local agent artifacts for this runtime. Git commits, branches, pull requests, and Cloud product records are preserved."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const pending = confirmDelete;
          if (!pending) {
            return;
          }
          setConfirmDelete(null);
          actions.purgeWorkspace(targetState.target, pending.workspaceId);
        }}
      />
    </>
  );
}

/**
 * One quiet summary line under the dialog title — replaces the old gauge
 * header. Local: "Local runtime · repo — 5 of 20 worktrees" (count follows
 * the active repo filter). Cloud: "Cloud sandbox — CPU 42% · RAM 31%".
 */
function worktreesSummary(
  targetState: RuntimePressureTargetState,
  repoFilter: string,
): string {
  if (targetState.target.location === "cloud") {
    const cpu = formatSummaryPercent(targetState.resourcePressure?.cpu?.normalizedPercent);
    const ram = formatSummaryPercent(targetState.resourcePressure?.memory?.percent);
    return `${targetState.target.label} — CPU ${cpu} · RAM ${ram}`;
  }

  const count = repoFilter === "all"
    ? targetState.worktreeCount
    : targetState.inventory.filter((row) => (
      row.materialized
      && row.associatedWorkspaces.length > 0
      && (row.repoRootName ?? repoLabelFromPath(row.path)) === repoFilter
    )).length;
  const repoLabel = repoFilter === "all" ? targetState.pressureRepoLabel : repoFilter;
  const scope = repoLabel
    ? `${targetState.target.label} · ${repoLabel}`
    : targetState.target.label;
  return `${scope} — ${count} of ${targetState.idealWorktreeCount} worktrees`;
}

function formatSummaryPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "unavailable";
}
