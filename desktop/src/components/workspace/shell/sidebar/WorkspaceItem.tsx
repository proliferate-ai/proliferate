import { useState, type ReactNode } from "react";
import {
  CLOUD_SIDEBAR_STATUS_DEFINITIONS,
  type CloudSidebarStatus,
} from "@/config/cloud-sidebar";
import {
  Archive,
  BrailleSweepBadge,
  CircleAlert,
  CloudIcon,
  Monitor,
  Pencil,
  Tree,
} from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SessionViewState } from "@/lib/domain/sessions/activity";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar";
import { SidebarActionButton } from "./SidebarActionButton";
import { WorkspaceRenamePopover } from "./WorkspaceRenamePopover";

const VARIANT_ICONS: Record<SidebarWorkspaceVariant, typeof Monitor> = {
  local: Monitor,
  worktree: Tree,
  cloud: CloudIcon,
};

const VARIANT_TOOLTIPS: Record<SidebarWorkspaceVariant, string> = {
  local: "Local · runs in the repo's working directory",
  worktree: "Worktree · isolated branch in a separate checkout",
  cloud: "Cloud · runs on remote infrastructure",
};

function formatRelativeTime(date: string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (seconds < 60) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (weeks < 5) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

const CONTEXT_ROW =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-sidebar-accent";

interface WorkspaceItemProps {
  name: string;
  /**
   * The label we would show if no rename override were set. Used as the
   * placeholder in the rename popover so the user knows what clearing the
   * override will reveal. Defaults to `name` when omitted.
   */
  defaultName?: string;
  /** Whether the workspace currently has a user-set rename. */
  hasDisplayNameOverride?: boolean;
  subtitle?: string | null;
  variant?: SidebarWorkspaceVariant;
  cloudStatus?: CloudSidebarStatus | null;
  active?: boolean;
  archived?: boolean;
  activity?: SessionViewState;
  additions?: number;
  deletions?: number;
  lastInteracted?: string | null;
  unread?: boolean;
  onSelect?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  /**
   * Persist a display name override. `null` clears it. Omit to disable the
   * Rename context menu item (e.g. for cloud entries).
   */
  onRename?: (displayName: string | null) => Promise<unknown>;
}

export function WorkspaceItem({
  name,
  defaultName,
  hasDisplayNameOverride = false,
  subtitle: _subtitle,
  variant = "local",
  cloudStatus = null,
  active = false,
  archived = false,
  activity = "idle",
  additions,
  deletions,
  lastInteracted,
  unread = false,
  onSelect,
  onArchive,
  onUnarchive,
  onRename,
}: WorkspaceItemProps) {
  // Suppress the "ready" status badge — the cloud variant icon already
  // conveys "this is a cloud workspace". Non-ready statuses (queued,
  // provisioning, syncing, cloning, starting, stopped, error) still show
  // because they carry information the icon doesn't.
  const cloudStatusDefinition =
    variant === "cloud" && cloudStatus && cloudStatus !== "ready"
      ? CLOUD_SIDEBAR_STATUS_DEFINITIONS[cloudStatus]
      : null;
  const VariantIcon = VARIANT_ICONS[variant];
  const [renameOpen, setRenameOpen] = useState(false);

  const slotIcon: { tooltip: string; element: ReactNode } =
    activity === "working"
      ? {
        tooltip: "Working",
        element: <BrailleSweepBadge className="text-sm text-muted-foreground" />,
      }
      : activity === "needs_input"
        ? {
          tooltip: "Needs input",
          element: <BrailleSweepBadge className="text-sm text-special" />,
        }
        : activity === "errored"
          ? {
            tooltip: "Error",
            element: <CircleAlert className="size-3 text-destructive" />,
          }
          : unread
            ? {
              tooltip: "Unread",
              element: <div className="size-1.5 rounded-full bg-unread" />,
            }
            : {
              tooltip: VARIANT_TOOLTIPS[variant],
              element: (
                <VariantIcon
                  className={`size-3 ${
                    archived ? "text-sidebar-muted-foreground/40" : "text-sidebar-muted-foreground"
                  }`}
                />
              ),
            };

  const row = (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={`group relative cursor-pointer select-none rounded-lg px-2 py-1 hover:bg-sidebar-accent focus-visible:outline-offset-[-2px] h-[30px] ${
        active ? "bg-sidebar-accent" : ""
      }`}
    >
      {/* Archive button — absolutely positioned right edge, visible on hover */}
      {(onArchive || onUnarchive) && (
        <div className="flex items-center gap-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 absolute right-0 top-0 z-10 h-full justify-center mr-px pr-0.5">
          <SidebarActionButton
            onClick={(e) => {
              e.stopPropagation();
              archived ? onUnarchive?.() : onArchive?.();
            }}
            title={archived ? "Unarchive workspace" : "Archive workspace"}
            className="size-5 rounded-sm"
            alwaysVisible
          >
            <Archive className="size-3" />
          </SidebarActionButton>
        </div>
      )}

      <div className="flex w-full items-center gap-1.5 text-sm leading-4">
        {/* Leading icon — variant by default, replaced by activity / unread
            indicators when present. One slot, not two columns. */}
        <div className="flex w-4 shrink-0 items-center justify-center">
          <Tooltip content={slotIcon.tooltip} className="inline-flex shrink-0 items-center justify-center">
            {slotIcon.element}
          </Tooltip>
        </div>

        {/* Title */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className={`flex flex-1 items-center gap-2 truncate text-base leading-5 ${
            archived ? "text-foreground/30" : "text-foreground"
          }`}>
            <span className="truncate select-none" draggable={false}>{name}</span>
          </div>
          {cloudStatusDefinition && (
            <div className="flex min-w-[24px] items-center justify-end gap-2">
              <span className={`shrink-0 rounded-full border px-1.5 py-0 text-xs uppercase tracking-[0.12em] ${cloudStatusDefinition.className}`}>
                {cloudStatusDefinition.label}
              </span>
            </div>
          )}
        </div>

        {/* Right-side info — timestamp or git stats */}
        <div className="flex items-stretch justify-end gap-1 min-w-[24px]">
          {active && additions !== undefined && deletions !== undefined && (additions > 0 || deletions > 0) && (
            <div className="text-sm leading-4 tabular-nums group-focus-within:opacity-0 group-hover:opacity-0">
              <span className="text-git-green">+{additions}</span>{" "}
              <span className="text-git-red">-{deletions}</span>
            </div>
          )}
          {!active && lastInteracted && (
            <div className="text-foreground/40 text-sm leading-4 tabular-nums truncate text-right group-focus-within:opacity-0 group-hover:opacity-0">
              {formatRelativeTime(lastInteracted)}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const contextMenu = (
    <PopoverButton
      trigger={row}
      triggerMode="contextMenu"
      stopPropagation
      className="w-52 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <>
          {onRename && (
            <button
              type="button"
              onClick={() => {
                close();
                setRenameOpen(true);
              }}
              className={CONTEXT_ROW}
            >
              <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">Rename</span>
            </button>
          )}
          {onArchive && !archived && (
            <button
              type="button"
              onClick={() => { close(); onArchive(); }}
              className={CONTEXT_ROW}
            >
              <Archive className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">Archive</span>
            </button>
          )}
          {onUnarchive && archived && (
            <button
              type="button"
              onClick={() => { close(); onUnarchive(); }}
              className={CONTEXT_ROW}
            >
              <Archive className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">Unarchive</span>
            </button>
          )}
        </>
      )}
    </PopoverButton>
  );

  if (!onRename) {
    return contextMenu;
  }

  // Wrap with a controlled rename popover. The trigger is a span containing
  // the context-menu-wrapped row; the popover is opened externally from the
  // "Rename" menu item, and double-click on the row also opens it as a
  // bonus affordance. Using doubleClick avoids conflicting with onSelect
  // (single click) and the existing right-click context menu.
  return (
    <WorkspaceRenamePopover
      currentName={name}
      defaultName={defaultName ?? name}
      hasOverride={hasDisplayNameOverride}
      onRename={onRename}
      externalOpen={renameOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) setRenameOpen(false);
      }}
      trigger={<div>{contextMenu}</div>}
    />
  );
}
