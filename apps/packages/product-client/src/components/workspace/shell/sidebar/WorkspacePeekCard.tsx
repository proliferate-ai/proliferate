import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clock } from "#product/primitives/icons/core";
import { FolderClosed } from "#product/primitives/icons/workspace";
import { GitBranchIcon, GitBranchStatusIcon } from "#product/primitives/icons/workspace-git";
import { FixedPositionLayer } from "#product/primitives/FixedPositionLayer";
import { POPOVER_FRAME_CLASS } from "#product/primitives/PopoverButton";
import { statusDotToneTextClass } from "#product/primitives/StatusDot";
import {
  prChecksLabel,
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
/**
 * Enough for the tallest card to stay on screen. Read off the card's anatomy
 * rather than guessed: header (~30px incl. its 6px bottom padding) + four
 * 26px rows + three 2px gaps + 20px of vertical padding ≈ 152, rounded up to
 * 160. A fifth row means this number moves with it.
 */
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
      className={`pointer-events-none fixed z-tooltip flex w-75 flex-col gap-0.5 px-3 py-2.5 ${POPOVER_FRAME_CLASS}`}
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
          icon={prView.kind === "merged" ? (
            // Merged is settled, so the whole glyph carries it and there is no
            // dot — the row's own convention. The ink is the shared tone map's
            // `text-pr-merged` rather than the row's `sidebar-status-worktree`
            // twin of it: this card sits on the popover surface, where the
            // rest of its inks are the popover's.
            <GitBranchIcon
              className={`${PEEK_ICON_BASE_CLASS} ${statusDotToneTextClass(prTone.tone)}`}
            />
          ) : (
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

/** Geometry only, so a row that owns its own ink can reuse it. */
const PEEK_ICON_BASE_CLASS = "icon-paired shrink-0";
const PEEK_ICON_CLASS = `${PEEK_ICON_BASE_CLASS} text-muted-foreground`;

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

/**
 * The card names the absence too, unlike the shared label: it renders a fixed
 * row rather than a tooltip segment, so an empty one would read as a bug.
 */
function checksLabel(status: WorkspaceGitStatus | null): string {
  return prChecksLabel(status?.pr?.checks ?? "none") ?? "No CI checks";
}

/**
 * Arms the peek on row hover and hands back the row's pointer handlers.
 *
 * The anchor is measured when the delay elapses rather than when the pointer
 * arrives, so a row that moved under the pointer (a list settling, a group
 * expanding) still anchors its card correctly.
 *
 * RECORDED REFUSAL (rule of two): `../tabs/DelegatedAgentHoverCard.tsx` is
 * the named twin of this shape — a hover-timed card anchored off the
 * trigger's rect and clamped to the viewport. It is deliberately NOT promoted
 * into a shared `useAnchoredHoverCard` primitive here, because the two differ
 * on exactly the axes such a primitive would have to take: that card is
 * interactive and holds itself open on a leave timer, this one never takes
 * the pointer and closes the instant the row is left. Choosing those axes is
 * a founder decision, not a mechanical lift.
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
