/**
 * Conductor-style workspaces list (UX spec §3): a cmdk filter-list, not a
 * table. Filter input row on top (border-b, search icon, 13px input), then a
 * scrolling list of recency-grouped rows:
 *
 *   [well: spinner | PR | branch glyph] [name 13px/500, 144px, truncate]
 *   [chevron 12px] [branch 13px truncate] [PR dot] [#805] [· meta]
 *   …… [↑2 ↓1] [last-used 12px faint, right-aligned]
 *
 * The leading well mirrors the sidebar ladder (running > PR > branch >
 * empty), uniformly `!size-3`, faint — destructive when the worktree has
 * merge conflicts. PR state at page scale is dot + number; the state words
 * live in the dot's tooltip (compound label).
 *
 * Rows are ~36px, radius 6px, `--accent` fill when selected; the selected row
 * swaps the date for `Go to →` (and hides the ahead/behind label). Group
 * headings are 13px/500 foreground with the item count in `--faint`. An
 * optional dashed "Create" row closes the list with a ⌘N hint.
 */
import { ChevronRight, FolderPlus, GitBranch, GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";
import { Spinner } from "@proliferate/ui/primitives/Spinner";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@proliferate/ui/kit/Command";

import { PrStatusDot, type PrStatusView } from "./PrStatusBadge";

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
  /** "#805" — rendered after the PR dot; included in the filter value. */
  prNumberLabel?: string | null;
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
  createShortcutLabel?: string;
  className?: string;
}

export function WorkspacesCommandList({
  groups,
  filterPlaceholder = "Filter workspaces...",
  emptyLabel = "No workspaces yet",
  filterRowActions = null,
  onWorkspaceSelect,
  onCreate,
  createShortcutLabel = "⌘N",
  className = "",
}: WorkspacesCommandListProps) {
  return (
    <Command
      className={twMerge("bg-transparent", className)}
      label="Workspaces"
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
            className="mt-2 w-full gap-2 border border-dashed border-border px-2.5 py-2 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[selected=true]:text-foreground"
          >
            <FolderPlus className="size-4 shrink-0" aria-hidden />
            <span>Create</span>
            <span className="ml-auto text-base text-faint opacity-0 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100">
              {createShortcutLabel}
            </span>
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

  return (
    <CommandItem
      value={`${item.id} ${item.title} ${branch ?? ""} ${meta ?? ""} ${item.prNumberLabel ?? ""}`.trim()}
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
                  <ChevronRight className="!size-3 flex-shrink-0 text-faint" aria-hidden />
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
    return <Spinner className="!size-3" />;
  }
  if (item.prStatus) {
    return <GitPullRequest className="!size-3" aria-hidden />;
  }
  if (branch) {
    return <GitBranch className="!size-3" aria-hidden />;
  }
  return null;
}
