import { useMemo, useState } from "react";
import type { WorktreeInventoryRow } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { Check, ListFilter, Search, SlidersHorizontal, Trash } from "@proliferate/ui/icons";
import {
  type RuntimePressureTargetState,
  type RuntimePressureTone,
  useRuntimePressureControlState,
} from "@/hooks/workspaces/facade/use-runtime-pressure-control-state";
import {
  worktreeGitStatusView,
  worktreeRowLabel,
  worktreeRowSearchText,
} from "@/lib/domain/workspaces/worktrees/worktree-inventory-presentation";

const STATUS_FILTERS: Array<{ value: WorktreeStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "clean", label: "Clean" },
  { value: "changes", label: "Changes" },
  { value: "conflicts", label: "Conflicts" },
  { value: "unknown", label: "Unknown" },
];

const SORT_OPTIONS: Array<{ value: WorktreeSortKey; label: string }> = [
  { value: "size", label: "Size" },
  { value: "sessions", label: "Chats" },
  { value: "name", label: "Name" },
];

export function RuntimePressureIndicator() {
  const pressure = useRuntimePressureControlState();
  const [open, setOpen] = useState(false);

  if (!pressure.visible || !pressure.indicator) {
    return null;
  }

  const indicator = pressure.indicator;
  const tooltip = compactPressureTooltip(indicator);

  return (
    <>
      <Tooltip content={tooltip}>
        <ComposerControlButton
          iconOnly
          tone="quiet"
          label="Workspace pressure"
          aria-label="Open pruning details"
          aria-haspopup="dialog"
          aria-expanded={open}
          icon={(
            <RuntimePressureRing
              tone={indicator.tone}
              progressPercent={indicator.ringProgressPercent}
              loading={pressure.isDiscovering || indicator.isLoading}
            />
          )}
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <RuntimePressureDetailsDialog
        open={open}
        targetState={indicator}
        actions={pressure.actions}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

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

type WorktreeStatusFilter = "all" | "clean" | "changes" | "conflicts" | "unknown";
type WorktreeSortKey = "size" | "name" | "sessions";

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

function WorktreeFilterMenu({
  repoOptions,
  repoFilter,
  statusFilter,
  onRepoFilterChange,
  onStatusFilterChange,
}: {
  repoOptions: string[];
  repoFilter: string;
  statusFilter: WorktreeStatusFilter;
  onRepoFilterChange: (value: string) => void;
  onStatusFilterChange: (value: WorktreeStatusFilter) => void;
}) {
  const active = repoFilter !== "all" || statusFilter !== "all";

  return (
    <PopoverButton
      align="end"
      className="w-52 rounded-lg border border-border/80 bg-popover/95 p-1 shadow-popover"
      trigger={(
        <Button type="button" variant="outline" size="sm" className={active ? "border-border/90 text-foreground" : ""}>
          <ListFilter className="size-3.5" />
          Filter
        </Button>
      )}
    >
      {(close) => (
        <div>
          {repoOptions.length > 1 ? (
            <>
              <MenuLabel label="Repo" />
              <MenuOption
                label="All repos"
                selected={repoFilter === "all"}
                onSelect={() => {
                  onRepoFilterChange("all");
                  close();
                }}
              />
              {repoOptions.map((repo) => (
                <MenuOption
                  key={repo}
                  label={repo}
                  selected={repoFilter === repo}
                  onSelect={() => {
                    onRepoFilterChange(repo);
                    close();
                  }}
                />
              ))}
              <MenuSeparator />
            </>
          ) : null}
          <MenuLabel label="Status" />
          {STATUS_FILTERS.map((option) => (
            <MenuOption
              key={option.value}
              label={option.label}
              selected={statusFilter === option.value}
              onSelect={() => {
                onStatusFilterChange(option.value);
                close();
              }}
            />
          ))}
        </div>
      )}
    </PopoverButton>
  );
}

function WorktreeSortMenu({
  sort,
  onSortChange,
}: {
  sort: WorktreeSortKey;
  onSortChange: (value: WorktreeSortKey) => void;
}) {
  const activeLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Size";

  return (
    <PopoverButton
      align="end"
      className="w-44 rounded-lg border border-border/80 bg-popover/95 p-1 shadow-popover"
      trigger={(
        <Button type="button" variant="outline" size="sm">
          <SlidersHorizontal className="size-3.5" />
          {activeLabel}
        </Button>
      )}
    >
      {(close) => (
        <div>
          {SORT_OPTIONS.map((option) => (
            <MenuOption
              key={option.value}
              label={option.label}
              selected={sort === option.value}
              onSelect={() => {
                onSortChange(option.value);
                close();
              }}
            />
          ))}
        </div>
      )}
    </PopoverButton>
  );
}

function MenuLabel({ label }: { label: string }) {
  return (
    <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
      {label}
    </div>
  );
}

function MenuOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <PopoverMenuItem
      density="compact"
      label={label}
      trailing={selected ? <Check className="size-3.5" /> : null}
      onClick={onSelect}
    />
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-border/60" />;
}

function WorktreeTableHeader() {
  return (
    <div className="grid h-7 min-w-[700px] grid-cols-[minmax(0,1fr)_74px_52px_82px_68px_136px] items-center gap-4 px-5 text-[10px] uppercase tracking-[0.04em] text-muted-foreground/60">
      <span>Worktree</span>
      <span>Status</span>
      <span className="text-right">Chats</span>
      <span className="text-right">Checkout</span>
      <span className="text-right">Logs</span>
      <span />
    </div>
  );
}

function RuntimeWorktreeRow({
  row,
  onDeleteOrphan,
  onPurgeWorkspace,
}: {
  row: WorktreeInventoryRow;
  onDeleteOrphan: (path: string) => void;
  onPurgeWorkspace: (workspaceId: string, label: string) => void;
}) {
  const status = worktreeGitStatusView(row.gitStatus);
  const label = worktreeRowLabel(row);
  const primaryWorkspace = row.associatedWorkspaces[0] ?? null;
  const branchLabel = row.branch ?? primaryWorkspace?.branch ?? "";
  const repoLabel = row.repoRootName ?? repoLabelFromPath(row.path);
  const canDeleteOrphan = row.state === "orphan_checkout"
    && row.availableActions.includes("delete_orphan_checkout");
  const canDeleteHistory = row.state !== "conflict"
    && row.availableActions.includes("delete_workspace_history");

  return (
    <div className="group grid min-h-10 min-w-[700px] grid-cols-[minmax(0,1fr)_74px_52px_82px_68px_136px] items-center gap-4 px-5 text-xs transition-colors hover:bg-foreground/[0.04]">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{label}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground/60">
          {branchLabel ? `${repoLabel} / ${branchLabel}` : repoLabel}
        </span>
      </div>
      <span className="truncate text-xs text-muted-foreground/70">{status.label}</span>
      <span className="text-right text-xs tabular-nums text-muted-foreground/70">{row.totalSessionCount}</span>
      <span className="text-right text-xs tabular-nums text-muted-foreground/80">
        {formatByteEstimate(row.storage?.worktreeBytes)}
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground/70">
        {formatByteEstimate(row.storage?.sqliteBytes)}
      </span>
      <div className="flex justify-end gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        {canDeleteOrphan ? (
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => onDeleteOrphan(row.path)}>
            <Trash className="size-3.5" />
            Delete
          </Button>
        ) : null}
        {row.associatedWorkspaces.map((workspace) => (
          <div key={workspace.id} className="flex items-center gap-1.5">
            {canDeleteHistory ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onPurgeWorkspace(workspace.id, workspace.displayName ?? label)}
              >
                <Trash className="size-3.5" />
                Delete
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyWorktreeState({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function rowStatusFilter(row: WorktreeInventoryRow): WorktreeStatusFilter {
  if (row.gitStatus?.state === "clean") {
    return "clean";
  }
  if (row.gitStatus?.state === "dirty") {
    return "changes";
  }
  if (row.gitStatus?.state === "conflicted") {
    return "conflicts";
  }
  return "unknown";
}

function compareWorktreeRows(
  left: WorktreeInventoryRow,
  right: WorktreeInventoryRow,
  sort: WorktreeSortKey,
): number {
  if (sort === "name") {
    return worktreeRowLabel(left).localeCompare(worktreeRowLabel(right));
  }
  if (sort === "sessions") {
    return right.totalSessionCount - left.totalSessionCount
      || worktreeRowLabel(left).localeCompare(worktreeRowLabel(right));
  }
  return storageTotalBytes(right) - storageTotalBytes(left)
    || worktreeRowLabel(left).localeCompare(worktreeRowLabel(right));
}

function summarizeStorage(rows: WorktreeInventoryRow[]): {
  worktreeBytes: number | null;
  sqliteBytes: number | null;
} {
  let worktreeBytes = 0;
  let sqliteBytes = 0;
  let hasWorktreeBytes = false;
  let hasSqliteBytes = false;

  for (const row of rows) {
    if (typeof row.storage?.worktreeBytes === "number" && Number.isFinite(row.storage.worktreeBytes)) {
      worktreeBytes += row.storage.worktreeBytes;
      hasWorktreeBytes = true;
    }
    if (typeof row.storage?.sqliteBytes === "number" && Number.isFinite(row.storage.sqliteBytes)) {
      sqliteBytes += row.storage.sqliteBytes;
      hasSqliteBytes = true;
    }
  }

  return {
    worktreeBytes: hasWorktreeBytes ? worktreeBytes : null,
    sqliteBytes: hasSqliteBytes ? sqliteBytes : null,
  };
}

function storageTotalBytes(row: WorktreeInventoryRow): number {
  if (typeof row.storage?.totalBytes === "number" && Number.isFinite(row.storage.totalBytes)) {
    return row.storage.totalBytes;
  }
  return (row.storage?.worktreeBytes ?? 0) + (row.storage?.sqliteBytes ?? 0);
}

function repoLabelFromPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Unknown repo";
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

function formatByteEstimate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.abs(value);
  if (abs < 1024) {
    return `~${Math.round(value)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let unitIndex = 0;
  while (Math.abs(scaled) >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const digits = Math.abs(scaled) >= 10 ? 0 : 1;
  return `~${scaled.toFixed(digits)} ${units[unitIndex]}`;
}

export function RuntimePressureRing({
  tone,
  progressPercent,
  loading = false,
}: {
  tone: RuntimePressureTone;
  progressPercent?: number | null;
  loading?: boolean;
}) {
  const classes = {
    success: "stroke-success/55",
    warning: "stroke-warning/60",
    destructive: "stroke-destructive/60",
    quiet: "stroke-muted-foreground/45",
  } satisfies Record<RuntimePressureTone, string>;
  const progress = typeof progressPercent === "number" && Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : 0;

  return (
    <svg
      viewBox="0 0 16 16"
      className={`block size-4 ${
        loading ? "animate-pulse" : ""
      }`}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        strokeWidth="2"
        className="fill-none stroke-muted-foreground/20"
      />
      <circle
        cx="8"
        cy="8"
        r="6"
        pathLength="100"
        strokeDasharray={`${progress} ${100 - progress}`}
        strokeLinecap="round"
        strokeWidth="2"
        transform="rotate(-90 8 8)"
        className={`fill-none transition-[stroke-dasharray] ${classes[tone]}`}
      />
    </svg>
  );
}

function formatRuntimePercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "Unavailable";
}

function formatRingProgress(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "unknown";
}

function compactPressureTooltip(targetState: RuntimePressureTargetState): string {
  const lines = [targetState.target.label];
  if (targetState.target.location === "cloud") {
    lines.push([
      `CPU ${formatRuntimePercent(targetState.resourcePressure?.cpu?.normalizedPercent)}`,
      `RAM ${formatRuntimePercent(targetState.resourcePressure?.memory?.percent)}`,
    ].join(" · "));
    if (targetState.pressurePercent !== null) {
      lines.push(`${formatRuntimePercent(targetState.pressurePercent)} pressure`);
    }
  } else {
    lines.push(
      `${targetState.worktreeCount}/${targetState.idealWorktreeCount} worktrees · ${formatRingProgress(targetState.ringProgressPercent)} of ideal`,
    );
  }
  lines.push("Click for details.");
  return lines.join("\n");
}
