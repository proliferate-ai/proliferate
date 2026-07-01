/**
 * Conductor-style workspaces list (UX spec §3): a cmdk filter-list, not a
 * table. Filter input row on top (border-b, search icon, 13px input), then a
 * scrolling list of recency-grouped rows:
 *
 *   [git-branch 12px faint] [name 13px/500, 144px, truncate] [chevron 12px]
 *   [branch 13px truncate] [PR dot] …… [last-used 12px faint, right-aligned]
 *
 * Rows are ~36px, radius 6px, `--accent` fill when selected; the selected row
 * swaps the date for `Go to →`. Group headings are 13px/500 foreground with
 * the item count in `--faint`. An optional dashed "Create" row closes the
 * list with a ⌘N hint.
 */
import { ChevronRight, FolderPlus, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@proliferate/ui/kit/Command";
import { Button } from "@proliferate/ui/primitives/Button";

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
  /**
   * PR status dot (spec §2 component). Render only when status exists —
   * nothing is invented when PR data is not plumbed.
   */
  prStatus?: PrStatusView | null;
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
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={onCreate}
            className="group/create mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-[13px] font-medium leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <FolderPlus className="size-4 shrink-0" aria-hidden />
            <span>Create</span>
            <span className="ml-auto text-[11px] text-faint opacity-0 transition-opacity group-hover/create:opacity-100">
              {createShortcutLabel}
            </span>
          </Button>
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

  return (
    <CommandItem
      value={`${item.id} ${item.title} ${branch ?? ""} ${meta ?? ""}`.trim()}
      onSelect={onSelect ? () => onSelect(item.id) : undefined}
      className="min-h-9"
    >
      <div className="flex w-full items-center gap-3">
        <div className="flex w-4 shrink-0 items-center justify-center">
          <GitBranch className="!size-3 text-faint" aria-hidden />
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
                <PrStatusDot status={item.prStatus} className="flex-shrink-0" />
              ) : null}
            </span>
            {meta ? (
              <span className="flex min-w-0 items-center gap-2 text-[12px] leading-4 text-faint">
                <span aria-hidden>·</span>
                <span className="truncate">{meta}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className="w-16 text-right text-[12px] leading-4 tabular-nums text-faint group-data-[selected=true]:hidden">
            {item.updatedLabel ?? ""}
          </span>
          <span className="hidden w-16 text-right text-[12px] leading-4 text-faint group-data-[selected=true]:inline">
            Go to →
          </span>
        </div>
      </div>
    </CommandItem>
  );
}
