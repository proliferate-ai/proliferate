import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "@proliferate/design/motion";
import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";
import { Button } from "#product/primitives/Button";
import { Trash } from "#product/primitives/icons/core";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";
import type {
  HeaderChatMenuEntry,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

// A deleted row outlives the live data as a collapsing ghost so the 0fr
// transition finishes even when the archive round-trip beats it; the slack
// covers timer scheduling past the CSS duration.
const GHOST_FINALIZE_MS = motion.delay.ghostRowFinalizeMs;

interface DeletingRowEntry {
  row: HeaderChatMenuEntry;
  index: number;
}

export function ClosedChatTabsMenu({
  rows: liveRows,
  renderIcon,
  onRestoreSession,
  onDeleteSession,
}: {
  rows: HeaderChatMenuEntry[];
  renderIcon: (row: Pick<HeaderChatMenuEntry, "agentKind" | "viewState" | "isResolvingSession">) => ReactNode;
  onRestoreSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
}) {
  // Rows collapse the moment delete is clicked, so rows above never move and
  // rows below slide up; a row only re-expands if the archive fails.
  const [deletingById, setDeletingById] = useState<
    ReadonlyMap<string, DeletingRowEntry>
  >(new Map());
  const finalizeTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearDeleting = useCallback((sessionId: string) => {
    const timer = finalizeTimersRef.current.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      finalizeTimersRef.current.delete(sessionId);
    }
    setDeletingById((current) => {
      if (!current.has(sessionId)) {
        return current;
      }
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }, []);

  useEffect(() => () => {
    for (const timer of finalizeTimersRef.current.values()) {
      clearTimeout(timer);
    }
    finalizeTimersRef.current.clear();
  }, []);

  // Once a deleted row leaves the live list it is a ghost; drop it after the
  // collapse transition has fully rendered.
  useEffect(() => {
    const liveIds = new Set(liveRows.map((row) => row.id));
    for (const sessionId of deletingById.keys()) {
      if (!liveIds.has(sessionId) && !finalizeTimersRef.current.has(sessionId)) {
        finalizeTimersRef.current.set(
          sessionId,
          setTimeout(() => clearDeleting(sessionId), GHOST_FINALIZE_MS),
        );
      }
    }
  }, [clearDeleting, deletingById, liveRows]);

  const deleteSession = (row: HeaderChatMenuEntry, index: number) => {
    setDeletingById((current) => new Map(current).set(row.id, { row, index }));
    // The grid-rows collapse animates on the main thread, so the archive (and
    // the header re-derivation it triggers) must wait out the transition or it
    // starves the animation into a single-frame snap. Deliberately not cleared
    // on unmount: closing the popover must not lose the deletion.
    setTimeout(() => {
      void Promise.resolve(onDeleteSession(row.id)).then(
        (archived) => {
          if (!archived) {
            clearDeleting(row.id);
          }
        },
        () => clearDeleting(row.id),
      );
    }, motion.duration.disclosureMs);
  };

  const rows = useMemo(() => {
    if (deletingById.size === 0) {
      return liveRows;
    }
    const liveIds = new Set(liveRows.map((row) => row.id));
    const ghosts = [...deletingById.values()]
      .filter((entry) => !liveIds.has(entry.row.id))
      .sort((a, b) => a.index - b.index);
    if (ghosts.length === 0) {
      return liveRows;
    }
    const merged = [...liveRows];
    for (const ghost of ghosts) {
      merged.splice(Math.min(ghost.index, merged.length), 0, ghost.row);
    }
    return merged;
  }, [deletingById, liveRows]);

  return (
    <div className="flex max-h-[70vh] flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row, index) => (
          <AnimatedCollapsibleContent key={row.id} expanded={!deletingById.has(row.id)}>
            <div
              data-telemetry-mask="true"
              className={`group/row flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-hover active:bg-active ${row.isActive ? "bg-selected" : ""}`}
              onClick={(event) => {
                const targetButton = event.target instanceof Element
                  ? event.target.closest("button")
                  : null;
                if (targetButton && event.currentTarget.contains(targetButton)) {
                  return;
                }
                onRestoreSession(row.id);
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md p-0 hover:bg-transparent"
                onClick={() => onRestoreSession(row.id)}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {renderIcon(row)}
                </span>
                <span className="flex-1 truncate text-left text-ui font-medium text-foreground">
                  {row.title}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={`Delete ${row.title}`}
                aria-label={`Delete ${row.title}`}
                className="size-6 shrink-0 rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
                onClick={() => deleteSession(row, index)}
              >
                <Trash className="icon-compact" />
              </Button>
              {row.closedAt && (
                <span className="shrink-0 text-ui-sm text-muted-foreground">
                  {formatRelativeTime(row.closedAt)}
                </span>
              )}
            </div>
          </AnimatedCollapsibleContent>
        ))}
      </div>
    </div>
  );
}
