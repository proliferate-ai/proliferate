/**
 * The workspaces list (UX spec §3): a cmdk filter-list, not a table. Filter
 * input row on top (border-b, search icon), then a scrolling list of
 * recency-grouped rows:
 *
 *   [well: spinner | PR | branch glyph] [name, 144px, truncate]
 *   [chevron] [branch truncate] [PR dot] [#805] [· meta]
 *   …… [placement badge] [session count] [↑2 ↓1] [last-used, right-aligned]
 *
 * The leading well mirrors the sidebar ladder (running > PR > branch >
 * empty), uniformly `!icon-paired`, faint — destructive when the worktree has
 * merge conflicts. PR state at page scale is dot + number; the state words
 * live in the dot's tooltip (compound label). Session count reuses that same
 * glyph-plus-number vocabulary so the trailing cluster reads as one system.
 *
 * Rows are ~36px, `--accent` fill when selected; the selected row swaps the
 * date for `Go to →` (and hides the ahead/behind label). Group headings carry
 * the item count in `--faint`. An optional dashed "Create" row closes the
 * list with an optional creation-shortcut hint.
 */
import { ChevronRight } from "#product/primitives/icons/core";
import { FolderPlus } from "#product/primitives/icons/workspace";
import { GitBranchIcon, GitPullRequest } from "#product/primitives/icons/workspace-git";
import { MessageSquare } from "#product/primitives/icons/product";
import type { ReactNode } from "react";
import { Badge } from "#product/primitives/Badge";
import { Spinner } from "#product/primitives/Spinner";
import { twMerge } from "#product/primitives/utils/tw-merge";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#product/primitives/Command";

import { PrStatusDot } from "#product/components/patterns/PrStatusBadge";
import type { PrStatusView } from "#product/lib/domain/workspaces/git-status/pr-status-presentation";

export interface WorkspacesCommandItemView {
  id: string;
  /** Workspace name — fixed-width leading cell (144px, truncate). */
  title: string;
  /** Git branch shown after the chevron. */
  branch?: string | null;
  /** Secondary `·`-separated meta (repo slug, session, …), 12px faint. */
  meta?: string | null;
  /** Relative last-used label, right-aligned tabular-nums. */
  updatedLabel?: string | null;
  /** PR status dot (spec §2 component). Render only when status exists. */
  prStatus?: PrStatusView | null;
  /** Agent activity (iterating / queued prompt) — spinner in the well. */
  running?: boolean;
  /** Merge conflicts in the worktree — destructive tint on the well glyph. */
  attention?: "conflicts" | null;
  /** "↑2 ↓1" — present only when ahead or behind > 0; hidden when selected. */
  aheadBehindLabel?: string | null;
  /** "#805" — rendered after the PR dot. */
  prNumberLabel?: string | null;
  /**
   * Session count for the workspace. Rendered as glyph + number in the
   * trailing cluster (same glyph-plus-number vocabulary as the PR dot and
   * its number). Omit when the count is unknown; `0` renders nothing, since
   * "no sessions yet" is the default state and not worth a mark.
   */
  sessionCount?: number | null;
  /**
   * Where the workspace runs, when that is not the local default: a quiet
   * neutral badge ("Cloud"). Local/worktree entries omit it rather
   * than label the common case.
   */
  placementLabel?: string | null;
}

export interface WorkspacesCommandGroupView {
  id: string;
  /** Recency heading — "Today", "Yesterday", "3 weeks ago", … */
  label: string;
  items: WorkspacesCommandItemView[];
}

export interface WorkspacesCommandListProps {
  groups: readonly WorkspacesCommandGroupView[];
  filterPlaceholder?: string;
  emptyLabel?: string;
  /** Extra controls rendered at the right edge of the filter input row. */
  filterRowActions?: ReactNode;
  onWorkspaceSelect?: (workspaceId: string) => void;
  onCreate?: () => void;
  createShortcutLabel?: string | null;
  className?: string;
}

export function WorkspacesCommandList({
  groups,
  filterPlaceholder = "Filter by name or branch...",
  emptyLabel = "No workspaces yet",
  filterRowActions = null,
  onWorkspaceSelect,
  onCreate,
  createShortcutLabel = null,
  className = "",
}: WorkspacesCommandListProps) {
  return (
    <Command
      className={twMerge("bg-transparent", className)}
      label="Workspaces"
      // Match only workspace name / branch (item keywords), never the id
      // value; a binary score keeps the recency ordering intact.
      filter={(_value, search, keywords) =>
        keywords?.some((keyword) =>
          keyword.toLowerCase().includes(search.toLowerCase()),
        )
          ? 1
          : 0}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border">
        <CommandInput
          placeholder={filterPlaceholder}
          wrapperClassName="min-w-0 flex-1 border-b-0"
        />
        {filterRowActions ? (
          <div className="flex shrink-0 items-center gap-1.5 pr-3">
            {filterRowActions}
          </div>
        ) : null}
      </div>
      <CommandList className="mx-auto w-full px-2 py-2">
        <CommandEmpty>{emptyLabel}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup
            key={group.id}
            className="mb-4 last:mb-0"
            heading={(
              <span className="flex items-center gap-2">
                {group.label}
                <span className="font-normal text-faint">{group.items.length}</span>
              </span>
            )}
          >
            {group.items.map((item) => (
              <WorkspaceCommandRow
                key={item.id}
                item={item}
                onSelect={onWorkspaceSelect}
              />
            ))}
          </CommandGroup>
        ))}
        {onCreate ? (
          <CommandItem
            // Keep the row mounted (and keyboard-reachable) even when the
            // current filter matches no workspace names.
            forceMount
            value="__create-workspace__"
            onSelect={() => onCreate()}
            className="mt-2 w-full gap-2 border border-dashed border-border px-2.5 py-2 font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground active:bg-active data-[selected=true]:text-foreground"
          >
            <FolderPlus className="icon-paired shrink-0" aria-hidden />
            <span>Create</span>
            {createShortcutLabel ? (
              <span className="ml-auto text-ui-sm text-faint opacity-0 transition-opacity duration-hover group-hover:opacity-100 group-data-[selected=true]:opacity-100">
                {createShortcutLabel}
              </span>
            ) : null}
          </CommandItem>
        ) : null}
      </CommandList>
    </Command>
  );
}

function WorkspaceCommandRow({
  item,
  onSelect,
}: {
  item: WorkspacesCommandItemView;
  onSelect?: (workspaceId: string) => void;
}) {
  const branch = item.branch ?? null;
  const meta = item.meta ?? null;
  const conflicted = item.attention === "conflicts";
  const sessionCount = item.sessionCount && item.sessionCount > 0 ? item.sessionCount : null;
  const placementLabel = item.placementLabel ?? null;

  return (
    <CommandItem
      value={item.id}
      keywords={branch ? [item.title, branch] : [item.title]}
      onSelect={onSelect ? () => onSelect(item.id) : undefined}
      className="min-h-9"
    >
      <div className="flex w-full items-center gap-3">
        <div
          className={twMerge(
            "flex w-4 shrink-0 items-center justify-center",
            conflicted ? "text-destructive" : "text-faint",
          )}
          title={conflicted ? "Merge conflicts in worktree" : undefined}
        >
          <WorkspaceRowGlyph item={item} branch={branch} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <span className="w-36 flex-shrink-0 truncate">{item.title}</span>
              {branch ? (
                <>
                  <ChevronRight className="!icon-paired flex-shrink-0 text-faint" aria-hidden />
                  <span className="truncate font-normal text-muted-foreground">{branch}</span>
                </>
              ) : null}
              {item.prStatus ? (
                <span className="flex flex-shrink-0 items-center gap-1.5 font-normal">
                  <PrStatusDot status={item.prStatus} className="flex-shrink-0" />
                  {item.prNumberLabel ? (
                    <span className="text-ui-sm text-faint">{item.prNumberLabel}</span>
                  ) : null}
                </span>
              ) : null}
            </span>
            {meta ? (
              <span className="flex min-w-0 items-center gap-2 text-ui-sm text-faint">
                <span aria-hidden>·</span>
                <span className="truncate">{meta}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          {placementLabel ? (
            <Badge tone="neutral" className="px-1.5 py-0 font-normal text-faint">
              {placementLabel}
            </Badge>
          ) : null}
          {sessionCount ? (
            <span
              className="flex items-center gap-1 text-ui-sm tabular-nums text-faint"
              title={sessionLabel(sessionCount)}
              aria-label={sessionLabel(sessionCount)}
            >
              <MessageSquare className="!icon-paired shrink-0" aria-hidden />
              {sessionCount}
            </span>
          ) : null}
          {item.aheadBehindLabel ? (
            <span className="text-ui-sm tabular-nums text-faint group-data-[selected=true]:hidden">
              {item.aheadBehindLabel}
            </span>
          ) : null}
          <span className="w-16 text-right text-ui-sm tabular-nums text-faint group-data-[selected=true]:hidden">
            {item.updatedLabel ?? ""}
          </span>
          <span className="hidden w-16 text-right text-ui-sm text-faint group-data-[selected=true]:inline">
            Go to →
          </span>
        </div>
      </div>
    </CommandItem>
  );
}

function sessionLabel(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

/**
 * Leading-well ladder (spec §4.2), mirroring the sidebar: running spinner >
 * PR glyph > branch glyph > empty reserved well. All glyphs `!size-3`,
 * toned by the well container (faint / destructive on conflicts).
 */
function WorkspaceRowGlyph({
  item,
  branch,
}: {
  item: WorkspacesCommandItemView;
  branch: string | null;
}) {
  if (item.running) {
    return <Spinner className="!icon-paired" />;
  }
  if (item.prStatus) {
    return <GitPullRequest className="!icon-paired" aria-hidden />;
  }
  if (branch) {
    return <GitBranchIcon className="!icon-paired" aria-hidden />;
  }
  return null;
}
