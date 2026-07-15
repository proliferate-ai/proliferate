import { useMemo, useState } from "react";
import type { WorktreeInventoryRow } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import { Check, GitBranch, X } from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import type {
  RuntimePressureTargetState,
  useRuntimePressureControlState,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import {
  resolveComposerControlOptionLabel,
} from "#product/lib/domain/chat/session-controls/composer-config-submenu-presentation";
import {
  worktreeGitStatusView,
  worktreeInventoryTotalMeta,
  worktreeRowLabel,
  worktreeRowSearchText,
  worktreeSizeMeta,
} from "#product/lib/domain/workspaces/worktrees/worktree-inventory-presentation";
import {
  StatusRow,
  StatusSection,
  type WorkspaceStatusDetailItem,
  type WorkspaceStatusDetailState,
} from "#product/components/workspace/chat/input/workspace-status/StatusCardPrimitives";
import { PendingConfigIndicator } from "#product/components/workspace/chat/input/PendingConfigIndicator";

export type EnvironmentCardActions = Pick<
  ReturnType<typeof useRuntimePressureControlState>["actions"],
  "pruneOrphan" | "purgeWorkspace"
>;

/** Hover-card list caps at this many worktrees; the modal shows the rest. */
const HOVER_ITEM_CAP = 12;

/**
 * The environment surface behind the composer's pressure ring, in the shared
 * status-card anatomy (StatusCardPrimitives). The card stays compact: a
 * Resources section with summary rows ("N worktrees" · total size, cloud
 * CPU/RAM) — hover shows the per-worktree list, click opens the searchable
 * worktrees modal — plus the session's advanced config controls inline, one
 * section per control, options click-to-select WITHOUT closing the surface
 * (multi-adjust, same contract the old "..." overflow menu had).
 */
export function EnvironmentStatusCard({
  targetState,
  advancedControls,
  agentKind,
  onOpenWorktrees,
}: {
  targetState: RuntimePressureTargetState | null;
  advancedControls: LiveSessionControlDescriptor[];
  agentKind: string | null;
  /** Resources rows are summaries — clicking one opens the searchable modal. */
  onOpenWorktrees: () => void;
}) {
  const inventory = targetState?.inventory ?? [];
  const isCloud = targetState?.target.location === "cloud";
  const worktreeHoverItems: WorkspaceStatusDetailItem[] = inventory
    .slice(0, HOVER_ITEM_CAP)
    .map((row) => {
      const status = worktreeGitStatusView(row.gitStatus);
      return {
        key: row.id,
        name: worktreeRowLabel(row),
        state: statusToDetailState(status.tone),
        detail: [status.label, status.detail].filter(Boolean).join(" · ") || undefined,
        meta: worktreeSizeMeta(row.storage),
      };
    });

  return (
    // Same codex card surface as the workspace-status card.
    <ComposerPopoverSurface
      variant="summary"
      className="w-[min(300px,calc(100vw-1rem))] overflow-hidden rounded-[1.25rem] p-0 pt-2.5 ring-0 shadow-[0_0_0_0.5px_var(--color-popover-ring),0_3px_7.5px_rgba(0,0,0,0.25),0_0_20px_rgba(0,0,0,0.28)]"
      data-telemetry-mask
    >
      <div className="flex max-h-[min(34rem,calc(100vh-8rem))] flex-col gap-3 overflow-y-auto pb-3">
        {targetState && (
          <StatusSection
            title="Resources"
            detail={!isCloud
              ? `${targetState.worktreeCount} of ${targetState.idealWorktreeCount}`
              : null}
          >
            <StatusRow
              icon={<GitBranch className="size-4" />}
              label={`${inventory.length} ${inventory.length === 1 ? "worktree" : "worktrees"}`}
              meta={worktreeInventoryTotalMeta(inventory)}
              hoverItems={worktreeHoverItems}
              onSelect={onOpenWorktrees}
            />
            {isCloud && (
              <>
                <StatusRow
                  label="CPU"
                  meta={formatPercent(targetState.resourcePressure?.cpu?.normalizedPercent)}
                />
                <StatusRow
                  label="Memory"
                  meta={formatPercent(targetState.resourcePressure?.memory?.percent)}
                />
              </>
            )}
          </StatusSection>
        )}

        {advancedControls.map((control) => (
          <StatusSection key={control.key} title={control.label}>
            {control.options.map((option) => (
              <StatusRow
                key={option.value}
                label={resolveComposerControlOptionLabel(
                  agentKind,
                  control,
                  option.value,
                  option.label,
                )}
                disabled={!control.settable}
                trailing={(
                  <span className="flex shrink-0 items-center gap-1">
                    {option.selected && <Check className="size-3.5 text-foreground/60" />}
                    {option.selected && control.pendingState && (
                      <PendingConfigIndicator pendingState={control.pendingState} />
                    )}
                  </span>
                )}
                // Intentionally does not close the surface — multi-adjust,
                // same contract the old overflow menu had.
                onSelect={() => control.onSelect(option.value)}
              />
            ))}
          </StatusSection>
        ))}
      </div>
    </ComposerPopoverSurface>
  );
}

/** The worktrees detail (always-searchable list + hover-delete rows) — the
 * modal body behind the card's summary row and the settings dialog. */
export function EnvironmentCardSections({
  targetState,
  onRequestPurge,
  onDeleteOrphan,
}: {
  targetState: RuntimePressureTargetState | null;
  onRequestPurge: (workspaceId: string, label: string) => void;
  onDeleteOrphan: (path: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const inventory = targetState?.inventory ?? [];
  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return inventory;
    }
    return inventory.filter((row) => worktreeRowSearchText(row).includes(needle));
  }, [filter, inventory]);

  const isCloud = targetState?.target.location === "cloud";
  const worktreesDetail = targetState && !isCloud
    ? `${targetState.worktreeCount} of ${targetState.idealWorktreeCount}`
    : null;

  return (
    <>
      {isCloud && targetState && (
          <StatusSection title={targetState.target.label}>
            <StatusRow
              label="CPU"
              meta={formatPercent(targetState.resourcePressure?.cpu?.normalizedPercent)}
            />
            <StatusRow
              label="Memory"
              meta={formatPercent(targetState.resourcePressure?.memory?.percent)}
            />
          </StatusSection>
        )}

        {targetState && (
          <StatusSection title="Worktrees" detail={worktreesDetail}>
            <div className="pb-1">
              <PopoverSearchField
                value={filter}
                onChange={setFilter}
                placeholder="Filter by name, branch..."
              />
            </div>
            {targetState.inventoryLoading ? (
              <StatusRow icon={<GitBranch className="size-4" />} label="Loading worktrees..." disabled />
            ) : targetState.inventoryError ? (
              <StatusRow icon={<GitBranch className="size-4" />} label="Runtime inventory is unavailable" disabled />
            ) : visibleRows.length === 0 ? (
              <StatusRow
                icon={<GitBranch className="size-4" />}
                label={inventory.length === 0 ? "No worktrees" : "No matches"}
                disabled
              />
            ) : (
              visibleRows.map((row) => (
                <WorktreeStatusRow
                  key={row.id}
                  row={row}
                  onRequestPurge={onRequestPurge}
                  onDeleteOrphan={onDeleteOrphan}
                />
              ))
            )}
          </StatusSection>
        )}
    </>
  );
}

/** One checkout: name · size, branch/status/chats in the hover card, delete
 * (orphan prune or history purge) revealed on hover like codex row actions. */
function WorktreeStatusRow({
  row,
  onRequestPurge,
  onDeleteOrphan,
}: {
  row: WorktreeInventoryRow;
  onRequestPurge: (workspaceId: string, label: string) => void;
  onDeleteOrphan: (path: string) => void;
}) {
  const status = worktreeGitStatusView(row.gitStatus);
  const label = worktreeRowLabel(row);
  const primaryWorkspace = row.associatedWorkspaces[0] ?? null;
  const branchLabel = row.branch ?? primaryWorkspace?.branch ?? null;
  const canDeleteOrphan = row.state === "orphan_checkout"
    && row.availableActions.includes("delete_orphan_checkout");
  const deletableWorkspace = row.state !== "conflict"
    && row.availableActions.includes("delete_workspace_history")
    ? primaryWorkspace
    : null;
  const onDelete = canDeleteOrphan
    ? () => onDeleteOrphan(row.path)
    : deletableWorkspace
      ? () => onRequestPurge(deletableWorkspace.id, deletableWorkspace.displayName ?? label)
      : null;

  const hoverItems: WorkspaceStatusDetailItem[] = [
    {
      key: "status",
      name: branchLabel ?? label,
      state: statusToDetailState(status.tone),
      detail: [status.label, status.detail].filter(Boolean).join(" · ") || undefined,
      meta: row.totalSessionCount > 0
        ? `${row.totalSessionCount} ${row.totalSessionCount === 1 ? "chat" : "chats"}`
        : undefined,
    },
  ];

  return (
    <StatusRow
      icon={<GitBranch className="size-4" />}
      label={label}
      meta={worktreeSizeMeta(row.storage)}
      hoverItems={hoverItems}
      trailing={onDelete
        ? (
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            aria-label={`Delete ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/status-row:opacity-100 group-focus-visible/status-row:opacity-100"
          >
            <X className="size-3.5" />
          </Button>
        )
        : undefined}
    />
  );
}

function statusToDetailState(
  tone: ReturnType<typeof worktreeGitStatusView>["tone"],
): WorkspaceStatusDetailState | undefined {
  if (tone === "destructive") {
    return "failing";
  }
  if (tone === "warning") {
    return "pending";
  }
  if (tone === "success") {
    return "done";
  }
  return undefined;
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "unavailable";
}
