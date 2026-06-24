import { useMemo, useState } from "react";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Search } from "@proliferate/ui/icons";
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

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        title="Pruning"
        description={`${targetState.target.label} pruning details`}
        headerContent={<PruningHeader targetState={targetState} repoFilter={repoFilter} />}
        sizeClassName="max-w-[760px] max-h-[84vh]"
        panelClassName="border-border/80 bg-[#181818] shadow-2xl"
        overlayClassName="bg-black/70 backdrop-blur-[1px]"
        bodyClassName="flex min-h-0 flex-col px-0 pb-0 pt-0"
        footerClassName="flex shrink-0 flex-col gap-2 border-t border-border/60 px-6 py-3 sm:flex-row sm:items-center sm:justify-between"
        footer={(
          <>
            <p className="min-w-0 text-xs text-muted-foreground">
              Delete removes the selected checkout and any attached runtime history.
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                {formatByteEstimate(storageSummary.worktreeBytes)} + {formatByteEstimate(storageSummary.sqliteBytes)}
              </span>
            </div>
          </>
        )}
      >
        <div className="flex items-center gap-2 px-6 pb-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by name, branch..."
              className="h-8 rounded-md border-border/70 bg-black/20 pl-8 text-sm"
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
        <div className="min-h-0 flex-1 overflow-auto border-t border-border/60">
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

function PruningHeader({
  targetState,
  repoFilter,
}: {
  targetState: RuntimePressureTargetState;
  repoFilter: string;
}) {
  return (
    <div className="space-y-4 px-1">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-base font-medium text-foreground">Pruning</h2>
          <span className="truncate text-xs text-muted-foreground">
            {targetState.target.location === "cloud" ? "Cloud sandbox" : "Local runtime"}
          </span>
        </div>
      </div>
      <div className="space-y-2.5">
        {targetState.target.location === "cloud" ? (
          <CloudGauges targetState={targetState} />
        ) : (
          <LocalGauge targetState={targetState} repoFilter={repoFilter} />
        )}
      </div>
    </div>
  );
}

function LocalGauge({
  targetState,
  repoFilter,
}: {
  targetState: RuntimePressureTargetState;
  repoFilter: string;
}) {
  const count = repoFilter === "all"
    ? targetState.worktreeCount
    : targetState.inventory.filter((row) => (
      row.materialized
      && row.associatedWorkspaces.length > 0
      && (row.repoRootName ?? repoLabelFromPath(row.path)) === repoFilter
    )).length;
  const repoLabel = repoFilter === "all"
    ? targetState.pressureRepoLabel ?? "worktrees"
    : repoFilter;

  return (
    <Gauge
      label={`in ${repoLabel}`}
      value={count}
      suffix=""
      limit={targetState.idealWorktreeCount}
      ratio={targetState.idealWorktreeCount > 0 ? count / targetState.idealWorktreeCount : null}
    />
  );
}

function CloudGauges({ targetState }: { targetState: RuntimePressureTargetState }) {
  return (
    <>
      <Gauge
        label="CPU"
        value={targetState.resourcePressure?.cpu?.normalizedPercent ?? null}
        suffix="%"
        limit={targetState.resourcePressure?.cpu?.idealMaxPercent ?? targetState.pressureLimitPercent}
        ratio={ratioFromPercent(
          targetState.resourcePressure?.cpu?.normalizedPercent ?? null,
          targetState.resourcePressure?.cpu?.idealMaxPercent ?? targetState.pressureLimitPercent,
        )}
        scaleMax={100}
      />
      <Gauge
        label="RAM"
        value={targetState.resourcePressure?.memory?.percent ?? null}
        suffix="%"
        limit={targetState.resourcePressure?.memory?.idealMaxPercent ?? targetState.pressureLimitPercent}
        ratio={ratioFromPercent(
          targetState.resourcePressure?.memory?.percent ?? null,
          targetState.resourcePressure?.memory?.idealMaxPercent ?? targetState.pressureLimitPercent,
        )}
        scaleMax={100}
      />
    </>
  );
}

function Gauge({
  label,
  value,
  suffix,
  limit,
  ratio,
  scaleMax,
}: {
  label: string;
  value: number | null;
  suffix: string;
  limit: number;
  ratio: number | null;
  scaleMax?: number;
}) {
  const finiteValue = typeof value === "number" && Number.isFinite(value) ? value : null;
  const width = finiteValue === null
    ? 0
    : Math.max(2, Math.min(100, (finiteValue / (scaleMax ?? limit)) * 100));
  const limitPosition = scaleMax
    ? Math.max(0, Math.min(100, (limit / scaleMax) * 100))
    : 100;

  return (
    <div className="flex items-center gap-3">
      <span className="w-[78px] shrink-0 truncate text-xs text-muted-foreground/70">{label}</span>
      <span className="w-[52px] shrink-0 text-right text-[13px] tabular-nums text-foreground">
        {finiteValue === null ? "--" : `${Math.round(finiteValue)}${suffix}`}
      </span>
      <div className="relative h-1.5 flex-1 rounded-full bg-foreground/[0.08]">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${width}%`,
            backgroundColor: gaugeFillColor(ratio),
          }}
        />
        <div
          className="absolute -top-0.5 bottom-[-2px] w-px bg-foreground/35"
          style={{ left: `${limitPosition}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
        {Math.round(limit)}
      </span>
    </div>
  );
}

function ratioFromPercent(value: number | null, limit: number): number | null {
  if (value === null || !Number.isFinite(value) || limit <= 0) {
    return null;
  }
  return value / limit;
}

function gaugeFillColor(ratio: number | null): string {
  if (ratio === null) {
    return "rgba(255,255,255,0.28)";
  }
  if (ratio >= 1) {
    return "#d98480";
  }
  if (ratio >= 0.75) {
    return "#cdb878";
  }
  return "rgba(255,255,255,0.5)";
}
