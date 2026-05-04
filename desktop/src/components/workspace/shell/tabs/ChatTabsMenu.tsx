import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { ChevronRight } from "@/components/ui/icons";
import { recordSubagentChildRelationshipHint } from "@/hooks/sessions/session-relationship-hints";
import type { HeaderChatMenuEntry } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import type { HeaderSubagentChildRow } from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";

const FLYOUT_WIDTH = 256;
const FLYOUT_OFFSET = 6;
const VIEWPORT_MARGIN = 8;
const CLOSE_GRACE_MS = 80;

interface FlyoutState {
  parentId: string;
  position: {
    top: number;
    left: number;
  };
}

export function ChatTabsMenu({
  workspaceId,
  rows,
  childrenByParentSessionId,
  renderIcon,
  renderStatus,
  onOpenSession,
}: {
  workspaceId: string | null;
  rows: HeaderChatMenuEntry[];
  childrenByParentSessionId: Map<string, HeaderSubagentChildRow[]>;
  renderIcon: (row: Pick<HeaderChatMenuEntry, "agentKind" | "viewState">) => ReactNode;
  renderStatus: (row: Pick<HeaderChatMenuEntry, "viewState" | "isActive">) => ReactNode;
  onOpenSession: (sessionId: string) => void;
}) {
  const activeAnchorRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [flyout, setFlyout] = useState<FlyoutState | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeFlyout = useCallback(() => {
    clearCloseTimer();
    activeAnchorRef.current = null;
    setFlyout(null);
  }, [clearCloseTimer]);

  const updateFlyoutPosition = useCallback((parentId: string, anchor: HTMLElement) => {
    const children = childrenByParentSessionId.get(parentId) ?? [];
    if (children.length === 0) {
      closeFlyout();
      return;
    }

    activeAnchorRef.current = anchor;
    setFlyout({
      parentId,
      position: computeFlyoutPosition(anchor.getBoundingClientRect(), children.length),
    });
  }, [childrenByParentSessionId, closeFlyout]);

  const openFlyout = useCallback((parentId: string, anchor: HTMLElement) => {
    clearCloseTimer();
    updateFlyoutPosition(parentId, anchor);
  }, [clearCloseTimer, updateFlyoutPosition]);

  const scheduleCloseFlyout = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      activeAnchorRef.current = null;
      setFlyout(null);
      closeTimerRef.current = null;
    }, CLOSE_GRACE_MS);
  }, [clearCloseTimer]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!flyout) {
      return;
    }

    const handleWindowChange = () => {
      const anchor = activeAnchorRef.current;
      if (!anchor) {
        setFlyout(null);
        return;
      }
      updateFlyoutPosition(flyout.parentId, anchor);
    };

    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [flyout, updateFlyoutPosition]);

  return (
    <div className="flex max-h-[70vh] flex-col overflow-hidden">
      <div className="shrink-0 px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Chat tabs
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => {
          const children = childrenByParentSessionId.get(row.id) ?? [];
          return (
            <div
              key={row.id}
              data-telemetry-mask="true"
              onMouseEnter={(event) => {
                if (children.length > 0) {
                  openFlyout(row.id, event.currentTarget);
                  return;
                }
                closeFlyout();
              }}
              onMouseLeave={() => {
                if (children.length > 0) {
                  scheduleCloseFlyout();
                }
              }}
            >
              <PopoverMenuItem
                icon={renderIcon(row)}
                label={row.title}
                trailing={(
                  <span className="flex shrink-0 items-center gap-1.5">
                    {renderStatus(row)}
                    {children.length > 0 && (
                      <ChevronRight className="size-3 text-muted-foreground/70" />
                    )}
                  </span>
                )}
                className={row.isActive ? "bg-accent/70" : ""}
                onClick={() => onOpenSession(row.id)}
              >
                {!row.isVisible && (
                  <span className="block truncate text-xs text-muted-foreground">
                    Hidden
                  </span>
                )}
              </PopoverMenuItem>
            </div>
          );
        })}
      </div>
      {flyout && createPortal(
        <SubagentFlyout
          workspaceId={workspaceId}
          children={childrenByParentSessionId.get(flyout.parentId) ?? []}
          position={flyout.position}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleCloseFlyout}
          onOpenSession={onOpenSession}
        />,
        document.body,
      )}
    </div>
  );
}

function SubagentFlyout({
  workspaceId,
  children,
  position,
  onMouseEnter,
  onMouseLeave,
  onOpenSession,
}: {
  workspaceId: string | null;
  children: HeaderSubagentChildRow[];
  position: FlyoutState["position"];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div
      data-telemetry-mask="true"
      className="fixed z-[70] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-floating"
      style={{
        top: position.top,
        left: position.left,
        width: FLYOUT_WIDTH,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children.map((child) => (
        <PopoverMenuItem
          key={child.sessionLinkId}
          label={child.title}
          trailing={renderSubagentTrailing(child)}
          className={child.isActive ? "bg-accent/70" : ""}
          disabled={child.source === "review"}
          title={child.source === "review" ? "Review agents are managed by the review run" : undefined}
          onClick={() => {
            if (child.source === "review") {
              return;
            }
            recordSubagentChildRelationshipHint({
              sessionId: child.sessionId,
              parentSessionId: child.parentSessionId,
              sessionLinkId: child.sessionLinkId,
              workspaceId,
            });
            onOpenSession(child.sessionId);
          }}
        >
          {child.meta && (
            <span className="block truncate text-xs text-muted-foreground">
              {child.meta}
            </span>
          )}
        </PopoverMenuItem>
      ))}
    </div>
  );
}

function computeFlyoutPosition(rect: DOMRect, childCount: number): FlyoutState["position"] {
  const estimatedHeight = Math.min(
    window.innerHeight - VIEWPORT_MARGIN * 2,
    Math.max(44, childCount * 44 + 8),
  );
  const rightLeft = rect.right + FLYOUT_OFFSET;
  const left = rightLeft + FLYOUT_WIDTH <= window.innerWidth - VIEWPORT_MARGIN
    ? rightLeft
    : Math.max(VIEWPORT_MARGIN, rect.left - FLYOUT_WIDTH - FLYOUT_OFFSET);
  const maxTop = window.innerHeight - VIEWPORT_MARGIN - estimatedHeight;

  return {
    left,
    top: Math.max(VIEWPORT_MARGIN, Math.min(rect.top, maxTop)),
  };
}

function renderSubagentTrailing(child: HeaderSubagentChildRow): ReactNode {
  if (child.wakeScheduled) {
    return <span className="text-xs text-foreground">Wake scheduled</span>;
  }
  if (child.statusLabel === "Failed") {
    return <span className="text-xs text-destructive">Failed</span>;
  }
  if (child.statusLabel === "Working") {
    return <span className="text-xs text-foreground">Working</span>;
  }
  if (child.isActive) {
    return <span className="size-1.5 rounded-full bg-foreground/70" />;
  }
  return <span className="text-xs text-muted-foreground">{child.statusLabel}</span>;
}
