import { type ReactNode } from "react";
import {
  Archive,
  Copy,
  MoreHorizontal,
  Pencil,
  RowActionIconButton,
  StickyNote,
  Trash,
} from "@proliferate/ui";

/**
 * The button's reveal contract is expressed against an owning row `group`, so
 * every cell composes it inside a realistic list row rather than on its own.
 */
function ListRowShell({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <div className="group flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui font-medium text-foreground">{title}</div>
        <div className="truncate text-ui-sm text-muted-foreground">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

export const RowActions = () => (
  <div className="flex w-96 flex-col gap-2">
    <ListRowShell title="Flat settings rows" meta="claude/design-sync-ui-import · 12 files">
      <RowActionIconButton label="Copy branch name" visibility="always">
        <Copy />
      </RowActionIconButton>
      <RowActionIconButton label="Rename workspace" visibility="always">
        <Pencil />
      </RowActionIconButton>
      <RowActionIconButton label="Delete workspace" visibility="always">
        <Trash />
      </RowActionIconButton>
    </ListRowShell>
    <ListRowShell title="Popover focus neutrality" meta="fix/popover-focus-neutrality · 3 files">
      <RowActionIconButton label="Copy branch name" visibility="always">
        <Copy />
      </RowActionIconButton>
      <RowActionIconButton label="Rename workspace" visibility="always">
        <Pencil />
      </RowActionIconButton>
      <RowActionIconButton label="Delete workspace" visibility="always">
        <Trash />
      </RowActionIconButton>
    </ListRowShell>
  </div>
);

/**
 * The default `visibility="hover"` variant is invisible at rest by design, so
 * this cell shows both ends of that contract: the resting row, and the same
 * row with the reveal classes overridden to their hovered values.
 */
export const RevealOnHover = () => (
  <div className="flex w-96 flex-col gap-4">
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm text-muted-foreground">Row at rest — actions hidden</span>
      <ListRowShell title="Release 0.4.2" meta="release/0.4.2 · merged 2 days ago">
        <RowActionIconButton label="Archive workspace">
          <Archive />
        </RowActionIconButton>
        <RowActionIconButton label="More actions">
          <MoreHorizontal />
        </RowActionIconButton>
      </ListRowShell>
    </div>
    <div className="flex flex-col gap-1">
      <span className="text-ui-sm text-muted-foreground">Row hovered — actions revealed</span>
      <ListRowShell title="Release 0.4.2" meta="release/0.4.2 · merged 2 days ago">
        <RowActionIconButton
          label="Archive workspace"
          className="pointer-events-auto opacity-100"
        >
          <Archive />
        </RowActionIconButton>
        <RowActionIconButton
          label="More actions"
          className="pointer-events-auto opacity-100"
        >
          <MoreHorizontal />
        </RowActionIconButton>
      </ListRowShell>
    </div>
  </div>
);

export const ActiveAndDisabled = () => (
  <div className="w-96">
    <ListRowShell title="Scratch pad" meta="Pinned to the workspace sidebar">
      <RowActionIconButton label="Pinned" visibility="always" active>
        <StickyNote />
      </RowActionIconButton>
      <RowActionIconButton label="Rename" visibility="always">
        <Pencil />
      </RowActionIconButton>
      <RowActionIconButton label="Delete (read-only workspace)" visibility="always" disabled>
        <Trash />
      </RowActionIconButton>
    </ListRowShell>
  </div>
);
