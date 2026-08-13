import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clock } from "#product/primitives/icons/core";
import { FolderClosed } from "#product/primitives/icons/workspace";
import { GitBranchIcon, GitBranchStatusIcon } from "#product/primitives/icons/workspace-git";
import { FixedPositionLayer } from "#product/primitives/FixedPositionLayer";
import { POPOVER_FRAME_CLASS } from "#product/primitives/PopoverButton";
import { statusDotToneTextClass } from "#product/primitives/StatusDot";
import {
  prStatusCompoundLabel,
  prStatusTone,
  prStatusViewFromGitStatus,
} from "#product/lib/domain/workspaces/git-status/pr-status-presentation";
import type { WorkspaceGitStatus } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";

/** Long enough that moving the pointer down a list never flashes cards. */
export const WORKSPACE_PEEK_DELAY_MS = 450;

/** Keep in step with the card's own `w-75`, which the clamp math cannot read. */
const CARD_WIDTH = 300;
const VIEWPORT_MARGIN = 8;
/** Enough for the tallest card (header + four rows) to stay on screen. */
const ESTIMATED_CARD_HEIGHT = 160;
/** Indents the card past the row's leading well, under the row's label. */
const ANCHOR_INSET = 28;
const ANCHOR_GAP = 4;

export interface WorkspacePeekContent {
  name: string;
  /** Relative last-activity label ("38m ago"). */
  time: string | null;
  repo: string | null;
  branch: string | null;
  gitStatus: WorkspaceGitStatus | null;
}

interface PeekAnchor {
  left: number;
  top: number;
}

/**
 * The hover peek for a sidebar workspace row: the git context that no longer
 * crowds the row itself.
 *
 * Read-only and non-interactive by design — it is a longer look at the row,
 * not a menu, so it never takes the pointer and it leaves the instant the
 * pointer does.
 */
export function WorkspacePeekCard({
  content,
  anchor,
}: {
  content: WorkspacePeekContent;
  anchor: PeekAnchor;
}) {
  const prView = prStatusViewFromGitStatus(content.gitStatus);
  const prLabel = prStatusCompoundLabel(content.gitStatus);
  const prTone = prView ? prStatusTone(prView.kind) : null;

  return createPortal(
    <FixedPositionLayer
      position={anchor}
      aria-hidden="true"
      data-workspace-peek-card
      // Non-interactive: the pointer must keep belonging to the row beneath.
      className={`pointer-events-none fixed z-popover flex w-75 flex-col gap-0.5 px-3 py-2.5 ${POPOVER_FRAME_CLASS}`}
    >
      <div className="flex items-baseline gap-2 px-0.5 pt-0.5 pb-1.5">
        <span className="min-w-0 flex-1 truncate text-ui font-medium">
          {content.name}
        </span>
        {content.time ? (
          <span className="shrink-0 text-ui-sm text-faint">{content.time}</span>
        ) : null}
      </div>

      {content.repo ? (
        <PeekRow icon={<FolderClosed className={PEEK_ICON_CLASS} />} label={content.repo} />
      ) : null}

      {content.branch ? (
        <PeekRow icon={<GitBranchIcon className={PEEK_ICON_CLASS} />} label={content.branch} />
      ) : null}

      {prView && prTone && prLabel ? (
        <PeekRow
          icon={(
            <GitBranchStatusIcon
              className={PEEK_ICON_CLASS}
              dotClassName={statusDotToneTextClass(prTone.tone)}
              dotFill={prTone.fill}
            />
          )}
          label={prLabel}
        />
      ) : null}

      <PeekRow
        icon={<Clock className={PEEK_ICON_CLASS} />}
        label={checksLabel(content.gitStatus)}
        muted
      />
    </FixedPositionLayer>,
    document.body,
  );
}

const PEEK_ICON_CLASS = "icon-paired shrink-0 text-muted-foreground";

function PeekRow({
  icon,
  label,
  muted = false,
}: {
  icon: ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="flex h-6.5 items-center gap-2.5 px-0.5">
      {icon}
      <span className={`min-w-0 truncate text-ui ${muted ? "text-muted-foreground" : ""}`}>
        {label}
      </span>
    </div>
  );
}

function checksLabel(status: WorkspaceGitStatus | null): string {
  switch (status?.pr?.checks) {
    case "passing":
      return "Checks passing";
    case "pending":
      return "Checks pending";
    case "failing":
      return "Checks failing";
    default:
      return "No CI checks";
  }
}

/**
 * Arms the peek on row hover and hands back the row's pointer handlers.
 *
 * The anchor is measured when the delay elapses rather than when the pointer
 * arrives, so a row that moved under the pointer (a list settling, a group
 * expanding) still anchors its card correctly.
 */
export function useWorkspacePeek(content: WorkspacePeekContent | null): {
  onPointerEnter: (event: { currentTarget: EventTarget & HTMLElement }) => void;
  onPointerLeave: () => void;
  peekCard: ReactNode;
} {
  const [anchor, setAnchor] = useState<PeekAnchor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback((
    event: { currentTarget: EventTarget & HTMLElement },
  ) => {
    // `currentTarget` is cleared once the handler returns; hold the element.
    const row = event.currentTarget;
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setAnchor(resolvePeekAnchor(row.getBoundingClientRect()));
    }, WORKSPACE_PEEK_DELAY_MS);
  }, [cancel]);

  const onPointerLeave = useCallback(() => {
    cancel();
    setAnchor(null);
  }, [cancel]);

  return {
    onPointerEnter,
    onPointerLeave,
    peekCard: content && anchor
      ? <WorkspacePeekCard content={content} anchor={anchor} />
      : null,
  };
}

function resolvePeekAnchor(row: DOMRect): PeekAnchor {
  const maxLeft = Math.max(
    VIEWPORT_MARGIN,
    window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN,
  );
  const maxTop = Math.max(
    VIEWPORT_MARGIN,
    window.innerHeight - ESTIMATED_CARD_HEIGHT - VIEWPORT_MARGIN,
  );
  return {
    left: Math.min(Math.max(row.left + ANCHOR_INSET, VIEWPORT_MARGIN), maxLeft),
    top: Math.min(Math.max(row.bottom + ANCHOR_GAP, VIEWPORT_MARGIN), maxTop),
  };
}
