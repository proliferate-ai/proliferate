import type { WorktreeInventoryRow } from "@anyharness/sdk";
import { Check, ListFilter, SlidersHorizontal, Trash } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  worktreeGitStatusView,
  worktreeRowLabel,
} from "@/lib/domain/workspaces/worktrees/worktree-inventory-presentation";

/** Shared column template — header and rows are separate grids, so the
 * template must stay identical for the columns to align. Name flexes; the
 * Status/Chats/Checkout/Logs columns are sized to their content and the
 * trailing actions column reserves exactly one Delete button's width so the
 * hover-revealed control never shifts the row or leaves a wide gutter. */
const WORKTREE_GRID_CLASS =
  "grid min-w-[640px] grid-cols-[minmax(0,1fr)_84px_48px_76px_60px_76px] items-center gap-3 px-5";

export type WorktreeStatusFilter = "all" | "clean" | "changes" | "conflicts" | "unknown";
export type WorktreeSortKey = "size" | "name" | "sessions";

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

export function WorktreeFilterMenu({
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
        <Button type="button" variant="ghost" size="sm" className={active ? "text-foreground" : ""}>
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

export function WorktreeSortMenu({
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
        <Button type="button" variant="ghost" size="sm">
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

export function WorktreeTableHeader() {
  return (
    <div className={`${WORKTREE_GRID_CLASS} h-8 border-b border-border/60 text-ui-sm text-muted-foreground`}>
      <span>Worktree</span>
      <span>Status</span>
      <span className="text-right">Chats</span>
      <span className="text-right">Checkout</span>
      <span className="text-right">Logs</span>
      <span />
    </div>
  );
}

export function RuntimeWorktreeRow({
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
  const branchLine = branchLabel ? `${repoLabel} / ${branchLabel}` : repoLabel;
  const isClean = row.gitStatus?.state === "clean";
  const canDeleteOrphan = row.state === "orphan_checkout"
    && row.availableActions.includes("delete_orphan_checkout");
  const canDeleteHistory = row.state !== "conflict"
    && row.availableActions.includes("delete_workspace_history");

  return (
    <div className={`group ${WORKTREE_GRID_CLASS} min-h-12 py-2 text-ui transition-colors hover:bg-foreground/[0.04]`}>
      <div className="min-w-0">
        <div className="truncate text-ui font-medium leading-5 text-foreground" title={label}>{label}</div>
        <div className="truncate text-ui-sm leading-4 text-muted-foreground" title={branchLine}>
          {branchLine}
        </div>
      </div>
      <span className="min-w-0">
        {isClean ? (
          <span className="block truncate text-ui-sm text-muted-foreground">{status.label}</span>
        ) : (
          <Badge tone={status.tone} className="truncate">{status.label}</Badge>
        )}
      </span>
      <span className="text-right text-ui tabular-nums text-muted-foreground">
        {row.totalSessionCount > 0 ? row.totalSessionCount : <span className="text-muted-foreground/50">—</span>}
      </span>
      <span className="text-right text-ui tabular-nums text-foreground">
        {formatByteEstimate(row.storage?.worktreeBytes)}
      </span>
      <span className="text-right text-ui tabular-nums text-muted-foreground">
        {formatByteEstimate(row.storage?.sqliteBytes)}
      </span>
      <div className="flex flex-wrap justify-end gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        {canDeleteOrphan ? (
          <WorktreeDeleteButton onClick={() => onDeleteOrphan(row.path)} />
        ) : null}
        {row.associatedWorkspaces.map((workspace) => (
          canDeleteHistory ? (
            <WorktreeDeleteButton
              key={workspace.id}
              onClick={() => onPurgeWorkspace(workspace.id, workspace.displayName ?? label)}
            />
          ) : null
        ))}
      </div>
    </div>
  );
}

function WorktreeDeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 text-ui-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      onClick={onClick}
    >
      <Trash className="size-3" />
      Delete
    </Button>
  );
}

export function EmptyWorktreeState({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center px-4 py-8 text-center text-ui-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function rowStatusFilter(row: WorktreeInventoryRow): WorktreeStatusFilter {
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

export function compareWorktreeRows(
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

export function summarizeStorage(rows: WorktreeInventoryRow[]): {
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

export function repoLabelFromPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Unknown repo";
}

/**
 * Sizes are always estimates, so table cells render them plain ("33 MB") and
 * only the footer totals carry the "~" (pass `approximate`) — repeating the
 * tilde on every cell was pure noise.
 */
export function formatByteEstimate(
  value: number | null | undefined,
  approximate = false,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const prefix = approximate ? "~" : "";
  const abs = Math.abs(value);
  if (abs < 1024) {
    return `${prefix}${Math.round(value)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let unitIndex = 0;
  while (Math.abs(scaled) >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const digits = Math.abs(scaled) >= 10 ? 0 : 1;
  return `${prefix}${scaled.toFixed(digits)} ${units[unitIndex]}`;
}

function MenuLabel({ label }: { label: string }) {
  return (
    <div className="px-2 py-1.5 text-base text-muted-foreground/70">
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

function storageTotalBytes(row: WorktreeInventoryRow): number {
  if (typeof row.storage?.totalBytes === "number" && Number.isFinite(row.storage.totalBytes)) {
    return row.storage.totalBytes;
  }
  return (row.storage?.worktreeBytes ?? 0) + (row.storage?.sqliteBytes ?? 0);
}
