import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefCallback,
} from "react";
import type { ChatTabEntry } from "@/hooks/sessions/use-workspace-chat-tabs";
import {
  partitionSessionTabsForOverflow,
  resolveSessionTabReservedWidth,
  type SessionTabOverflowItem,
} from "@/lib/domain/chat/tab-overflow";

const TAB_MAX_WIDTH = 176;
const TAB_MIN_WIDTH = 72;
const TAB_GAP_WIDTH = 4;
const CHAT_TAB_BASE_WIDTH = 62;
const CHAT_STATUS_BADGE_WIDTH = 18;
const FILE_TAB_BASE_WIDTH = 76;
const NEW_CHAT_CONTROL_RESERVE = 32;
const OVERFLOW_CONTROL_RESERVE = 36;
const APPROX_CHAR_WIDTH = 7;
const FILE_TABS_MAX_RESERVE_RATIO = 0.45;
const MIN_VISIBLE_CHAT_TABS = 2;
const EMPTY_PROMOTED_SESSION_IDS: string[] = [];

interface UseSessionTabOverflowArgs {
  chatTabs: ChatTabEntry[];
  activeSessionId: string | null;
  promotedSessionIds?: string[];
  fileTabLabels: string[];
}

interface UseSessionTabOverflowResult {
  containerRef: RefCallback<HTMLDivElement>;
  visibleTabs: ChatTabEntry[];
  overflowTabs: ChatTabEntry[];
  hasOverflow: boolean;
}

let measurementContext: CanvasRenderingContext2D | null | undefined;

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementContext !== undefined) {
    return measurementContext;
  }

  if (typeof document === "undefined") {
    measurementContext = null;
    return measurementContext;
  }

  measurementContext = document.createElement("canvas").getContext("2d");
  if (measurementContext) {
    measurementContext.font = "12px Inter, system-ui, sans-serif";
  }
  return measurementContext;
}

function estimateTextWidth(label: string): number {
  const context = getMeasurementContext();
  return context?.measureText(label).width ?? label.length * APPROX_CHAR_WIDTH;
}

function estimateTabWidth(label: string, baseWidth: number, extraWidth = 0): number {
  return Math.max(
    TAB_MIN_WIDTH,
    Math.min(TAB_MAX_WIDTH, Math.ceil(baseWidth + extraWidth + estimateTextWidth(label))),
  );
}

function estimateChatTabWidths(chatTabs: ChatTabEntry[]): SessionTabOverflowItem[] {
  return chatTabs.map((tab) => ({
    id: tab.id,
    width: estimateTabWidth(
      tab.title,
      CHAT_TAB_BASE_WIDTH,
      tab.viewState === "idle" ? 0 : CHAT_STATUS_BADGE_WIDTH,
    ),
  }));
}

function estimateFileTabsReserve(fileTabLabels: string[]): number {
  if (fileTabLabels.length === 0) {
    return 0;
  }

  return fileTabLabels.reduce((sum, label, index) => (
    sum
      + estimateTabWidth(label, FILE_TAB_BASE_WIDTH)
      + (index === 0 ? 0 : TAB_GAP_WIDTH)
  ), 0);
}

function estimateProtectedChatWidth(
  tabWidths: SessionTabOverflowItem[],
  activeSessionId: string | null,
): number {
  const protectedTabs: SessionTabOverflowItem[] = [];
  const activeTab = activeSessionId
    ? tabWidths.find((tab) => tab.id === activeSessionId) ?? null
    : null;

  if (tabWidths[0]) {
    protectedTabs.push(tabWidths[0]);
  }
  if (activeTab && !protectedTabs.some((tab) => tab.id === activeTab.id)) {
    protectedTabs.push(activeTab);
  }

  for (const tab of tabWidths) {
    if (protectedTabs.length >= MIN_VISIBLE_CHAT_TABS) {
      break;
    }
    if (!protectedTabs.some((protectedTab) => protectedTab.id === tab.id)) {
      protectedTabs.push(tab);
    }
  }

  if (protectedTabs.length === 0) {
    return 0;
  }

  return protectedTabs.reduce((sum, tab) => sum + tab.width, 0)
    + TAB_GAP_WIDTH * (protectedTabs.length - 1);
}

export function useSessionTabOverflow({
  chatTabs,
  activeSessionId,
  promotedSessionIds = EMPTY_PROMOTED_SESSION_IDS,
  fileTabLabels,
}: UseSessionTabOverflowArgs): UseSessionTabOverflowResult {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  const updateAvailableWidth = useCallback((width: number) => {
    const nextWidth = Math.max(0, Math.floor(width));
    setAvailableWidth((current) => current === nextWidth ? current : nextWidth);
  }, []);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
    if (node) {
      updateAvailableWidth(node.getBoundingClientRect().width);
    }
  }, [updateAvailableWidth]);

  useEffect(() => {
    if (!container || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateAvailableWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, updateAvailableWidth]);

  const tabWidths = useMemo(
    () => estimateChatTabWidths(chatTabs),
    [chatTabs],
  );
  const fileTabsReserveWidth = useMemo(
    () => estimateFileTabsReserve(fileTabLabels),
    [fileTabLabels],
  );
  const protectedChatWidth = useMemo(
    () => estimateProtectedChatWidth(tabWidths, activeSessionId),
    [activeSessionId, tabWidths],
  );
  const reservedWidth = useMemo(() => {
    return resolveSessionTabReservedWidth({
      availableWidth,
      fixedControlWidth: NEW_CHAT_CONTROL_RESERVE,
      fileTabsWidth: fileTabsReserveWidth,
      fileTabsMaxReserveRatio: FILE_TABS_MAX_RESERVE_RATIO,
      protectedSessionWidth: protectedChatWidth,
      overflowControlWidth: chatTabs.length > MIN_VISIBLE_CHAT_TABS
        ? OVERFLOW_CONTROL_RESERVE
        : 0,
      gapWidth: TAB_GAP_WIDTH,
    });
  }, [availableWidth, chatTabs.length, fileTabsReserveWidth, protectedChatWidth]);

  const partition = useMemo(
    () => partitionSessionTabsForOverflow({
      tabs: tabWidths,
      activeId: activeSessionId,
      promotedIds: promotedSessionIds,
      availableWidth,
      reservedWidth,
      overflowControlWidth: OVERFLOW_CONTROL_RESERVE,
      gapWidth: TAB_GAP_WIDTH,
      minimumVisibleCount: MIN_VISIBLE_CHAT_TABS,
    }),
    [activeSessionId, availableWidth, promotedSessionIds, reservedWidth, tabWidths],
  );

  const tabsById = useMemo(
    () => new Map(chatTabs.map((tab) => [tab.id, tab] as const)),
    [chatTabs],
  );

  const visibleTabs = useMemo(
    () => partition.visibleIds.flatMap((id) => {
      const tab = tabsById.get(id);
      return tab ? [tab] : [];
    }),
    [partition.visibleIds, tabsById],
  );

  const overflowTabs = useMemo(
    () => partition.overflowIds.flatMap((id) => {
      const tab = tabsById.get(id);
      return tab ? [tab] : [];
    }),
    [partition.overflowIds, tabsById],
  );

  return {
    containerRef,
    visibleTabs,
    overflowTabs,
    hasOverflow: partition.hasOverflow,
  };
}
