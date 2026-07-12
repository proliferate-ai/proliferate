import { useCallback, useRef, type KeyboardEvent } from "react";
import { X } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import type { NavigationCloseChildAgent } from "@/lib/domain/playground/subagents-ux/navigation-close-model";
import { SubagentIdentityGlyph } from "../identity-receipts/SubagentIdentityGlyph";

export function NavigationCloseTabs({
  parentTabId,
  openTabIds,
  activeTabId,
  parentTitle,
  childById,
  onSelectTab,
  onCloseTab,
}: {
  parentTabId: string;
  openTabIds: string[];
  activeTabId: string;
  parentTitle: string;
  childById: (id: string) => NavigationCloseChildAgent | undefined;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}) {
  const tablistRef = useRef<HTMLDivElement | null>(null);

  // Roving focus: arrows/Home/End move DOM focus across [role=tab] buttons.
  const onTablistKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabButtons = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [],
    );
    if (tabButtons.length === 0) return;
    const currentIndex = tabButtons.findIndex((button) => button === document.activeElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabButtons.length - 1
        : event.key === "ArrowLeft"
          ? (currentIndex <= 0 ? tabButtons.length - 1 : currentIndex - 1)
          : (currentIndex === -1 || currentIndex === tabButtons.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    tabButtons[nextIndex]?.focus();
  }, []);

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label="Parent and child sessions"
      onKeyDown={onTablistKeyDown}
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5"
    >
      {openTabIds.map((tabId) => {
        const isParent = tabId === parentTabId;
        const child = isParent ? undefined : childById(tabId);
        if (!isParent && !child) return null;
        const selected = activeTabId === tabId;
        const title = isParent ? parentTitle : child!.title;
        return (
          <div
            key={tabId}
            className={`group/tab flex max-w-[220px] shrink-0 items-center rounded-md border ${
              selected
                ? "border-border bg-accent text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60"
            }`}
          >
            {!isParent ? (
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                aria-label={`Close tab for ${title} (keeps the agent running)`}
                title="Close tab — the agent keeps running"
                onClick={() => onCloseTab(tabId)}
                className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100"
              >
                <X className="size-3" aria-hidden="true" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              role="tab"
              id={`nav-close-tab-${tabId}`}
              aria-selected={selected}
              aria-controls="nav-close-transcript"
              tabIndex={selected ? 0 : -1}
              title={title}
              onClick={() => onSelectTab(tabId)}
              className={`flex min-w-0 items-center gap-1.5 py-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border ${isParent ? "pl-2" : "pl-1"}`}
            >
              {child ? (
                <SubagentIdentityGlyph
                  seed={child.id}
                  size={14}
                  dimmed={child.status === "closed"}
                  label={`Identity mark for ${child.title}`}
                />
              ) : null}
              <span className="truncate text-ui font-medium">{title}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
