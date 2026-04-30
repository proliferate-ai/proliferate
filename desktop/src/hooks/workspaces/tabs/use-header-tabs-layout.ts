import { useMemo } from "react";
import type { HeaderChatStripRow } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import {
  computeHeaderStripLayout,
  computeChromeTabPositions,
  computeChromeTabWidths,
} from "@/lib/domain/workspaces/tabs/chrome-layout";

export function useHeaderTabsLayout({
  chatWidth,
  fileWidth,
  stripRows,
  openTabs,
}: {
  chatWidth: number;
  fileWidth: number;
  stripRows: HeaderChatStripRow[];
  openTabs: string[];
}) {
  const chatLayout = useMemo(() => {
    return computeHeaderStripLayout({
      containerWidth: chatWidth,
      reservedWidth: 0,
      rows: stripRows,
    });
  }, [chatWidth, stripRows]);

  const chatGroupUnderlines = useMemo(() => {
    const ranges = new Map<string, {
      color: string;
      left: number;
      right: number;
    }>();

    stripRows.forEach((row, index) => {
      if (row.kind === "pill") {
        if (row.isCollapsed) {
          return;
        }
        const left = chatLayout.positions[index] ?? 0;
        const right = left + (chatLayout.widths[index] ?? 0);
        ranges.set(row.groupId, {
          color: row.color,
          left,
          right,
        });
        return;
      }

      if (row.kind !== "tab" || !row.tab.groupColor || !row.tab.visualGroupId) {
        return;
      }
      const left = (chatLayout.positions[index] ?? 0) + 10;
      const right = (chatLayout.positions[index] ?? 0) + (chatLayout.widths[index] ?? 0) - 10;
      const current = ranges.get(row.tab.visualGroupId);
      if (current) {
        current.left = Math.min(current.left, left);
        current.right = Math.max(current.right, right);
      } else {
        ranges.set(row.tab.visualGroupId, {
          color: row.tab.groupColor,
          left,
          right,
        });
      }
    });

    return [...ranges.entries()].map(([groupId, range]) => ({
      groupId,
      color: range.color,
      left: range.left,
      width: Math.max(0, range.right - range.left),
    }));
  }, [chatLayout.positions, chatLayout.widths, stripRows]);

  const chatDragRows = useMemo(
    () => stripRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.kind === "tab" || row.groupKind === "subagent")
      .map(({ row, index }) => ({
        id: getChatDragRowId(row),
        sourceId: getChatDragSourceId(row),
        left: chatLayout.positions[index] ?? 0,
        width: chatLayout.widths[index] ?? 0,
      })),
    [chatLayout.positions, chatLayout.widths, stripRows],
  );

  const fileLayout = useMemo(() => {
    const widths = computeChromeTabWidths({
      containerWidth: fileWidth,
      reservedWidth: 0,
      tabCount: openTabs.length,
      maxWidth: 200,
    });
    return {
      widths,
      positions: computeChromeTabPositions(widths),
    };
  }, [fileWidth, openTabs.length]);

  const fileDragRows = useMemo(
    () => openTabs.map((path, index) => ({
      id: getFileDragRowId(path),
      sourceId: path,
      left: fileLayout.positions[index] ?? 0,
      width: fileLayout.widths[index] ?? 0,
    })),
    [fileLayout.positions, fileLayout.widths, openTabs],
  );

  return {
    chatLayout,
    chatGroupUnderlines,
    chatDragRows,
    fileLayout,
    fileDragRows,
  };
}

export function getChatDragRowId(row: {
  kind: "pill";
  groupId: string;
} | {
  kind: "tab";
  tab: { id: string };
}): string {
  return row.kind === "pill" ? `pill:${row.groupId}` : `chat:${row.tab.id}`;
}

function getChatDragSourceId(row: {
  kind: "pill";
  groupId: string;
} | {
  kind: "tab";
  tab: { id: string };
}): string {
  return row.kind === "pill" ? row.groupId : row.tab.id;
}

export function getFileDragRowId(path: string): string {
  return `file:${path}`;
}
