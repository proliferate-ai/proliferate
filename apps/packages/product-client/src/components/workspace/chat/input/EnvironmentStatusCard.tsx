import { useMemo, useState } from "react";
import type { WorktreeInventoryRow } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import { Check, GitBranch, X } from "@proliferate/ui/icons";
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
  DetailStateGlyph,
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
 * Resources: summary rows for the runtime the workspace-status card tracks —
 * "N worktrees" with total size (hover lists each checkout, click opens the
 * searchable worktrees modal) plus CPU/RAM on cloud targets. Replaces the
 * composer's old pressure-ring control.
 */
export function ResourcesSection({
  targetState,
  onOpenWorktrees,
}: {
  targetState: RuntimePressureTargetState;
  onOpenWorktrees: () => void;
}) {
  const inventory = targetState.inventory;
  const isCloud = targetState.target.location === "cloud";
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
    <StatusSection
      title="Resources"
      detail={!isCloud
        ? `${targetState.worktreeCount} of ${targetState.idealWorktreeCount}`
        : null}
    >
      <StatusRow
        icon={<GitBranch className="icon-paired" />}
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
  );
}

/**
 * The session's advanced config in card anatomy — one section per control,
 * options click-to-select WITHOUT closing the surface (multi-adjust, same
 * contract the removed "..." overflow menu had).
 */
export function AdvancedControlSections({
  controls,
  agentKind,
}: {
  controls: LiveSessionControlDescriptor[];
  agentKind: string | null;
}) {
  return (
    <>
      {controls.map((control) => (
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
                  {option.selected && <Check className="icon-paired text-foreground/60" />}
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
    </>
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
              <StatusRow icon={<GitBranch className="icon-paired" />} label="Loading worktrees..." disabled />
            ) : targetState.inventoryError ? (
              <StatusRow icon={<GitBranch className="icon-paired" />} label="Runtime inventory is unavailable" disabled />
            ) : visibleRows.length === 0 ? (
              <StatusRow
                icon={<GitBranch className="icon-paired" />}
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

/** One checkout, in the exact anatomy of the card's hover list (StatusRow
 * tooltip items) so moving from hover card to modal doesn't change the UI:
 * status glyph, name over a status detail line, size meta — plus a delete
 * (orphan prune or history purge) revealed on hover. */
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

  const detailLine = [
    status.label,
    status.detail,
    row.totalSessionCount > 0
      ? `${row.totalSessionCount} ${row.totalSessionCount === 1 ? "chat" : "chats"}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="group/worktree-row relative isolate flex min-w-0 items-start gap-2 rounded-md py-1.5 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-md before:content-[''] hover:before:bg-list-hover">
      <span className="flex h-4 w-[18px] shrink-0 items-center justify-start">
        <DetailStateGlyph state={statusToDetailState(status.tone)} emphasizeFailing />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-ui text-foreground" title={label}>{label}</span>
        {detailLine ? (
          <span className="line-clamp-2 text-ui-sm leading-4 text-muted-foreground">
            {detailLine}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-ui-sm text-faint">{worktreeSizeMeta(row.storage)}</span>
      {onDelete && (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label={`Delete ${label}`}
          onClick={onDelete}
          className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/worktree-row:opacity-100 focus-visible:opacity-100"
        >
          <X className="icon-paired" />
        </Button>
      )}
    </div>
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
