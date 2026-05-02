import { useMemo } from "react";
import type { HeaderWorkspaceShellStripRow } from "@/hooks/workspaces/tabs/use-workspace-header-tabs-view-model";
import {
  computeHeaderStripLayout,
} from "@/lib/domain/workspaces/tabs/chrome-layout";
import type { WorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";

export function useHeaderTabsLayout({
  width,
  shellRows,
}: {
  width: number;
  shellRows: HeaderWorkspaceShellStripRow[];
}) {
  const layout = useMemo(() => {
    return computeHeaderStripLayout({
      containerWidth: width,
      reservedWidth: 0,
      rows: shellRows.map((row) => ({
        kind: row.kind === "chat" && row.row.kind === "pill" ? "pill" : "tab",
      })),
    });
  }, [shellRows, width]);

  const chatGroupUnderlines = useMemo(() => {
    const ranges = new Map<string, {
      color: string;
      left: number;
      right: number;
    }>();

    shellRows.forEach((shellRow, index) => {
      if (shellRow.kind !== "chat") {
        return;
      }

      const row = shellRow.row;
      if (row.kind === "pill") {
        if (row.isCollapsed || !row.color) {
          return;
        }
        const left = layout.positions[index] ?? 0;
        const right = left + (layout.widths[index] ?? 0);
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
      const left = (layout.positions[index] ?? 0) + 10;
      const right = (layout.positions[index] ?? 0) + (layout.widths[index] ?? 0) - 10;
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
  }, [layout.positions, layout.widths, shellRows]);

  const dragRows = useMemo(
    () => shellRows
      .map((row, index) => ({
        id: getShellDragRowId(row),
        sourceId: getShellDragSourceId(row),
        left: layout.positions[index] ?? 0,
        width: layout.widths[index] ?? 0,
      })),
    [layout.positions, layout.widths, shellRows],
  );
  const dragUnitsBySourceId = useMemo(() => {
    const units = new Map<string, WorkspaceShellTabKey[]>();
    for (const row of shellRows) {
      units.set(getShellDragSourceId(row), getShellDragUnitIds(row));
    }
    return units;
  }, [shellRows]);

  return {
    layout,
    chatGroupUnderlines,
    dragRows,
    dragUnitsBySourceId,
  };
}

export function getShellDragRowId(row: HeaderWorkspaceShellStripRow): string {
  if (row.kind === "viewer") {
    return row.shellKey;
  }
  return row.row.kind === "pill" ? `pill:${row.row.groupId}` : `chat:${row.row.tab.id}`;
}

function getShellDragSourceId(row: HeaderWorkspaceShellStripRow): string {
  if (row.kind === "viewer") {
    return row.shellKey;
  }
  return row.row.kind === "pill" ? row.shellKeys[0] ?? row.row.groupId : row.shellKeys[0];
}

function getShellDragUnitIds(row: HeaderWorkspaceShellStripRow): WorkspaceShellTabKey[] {
  if (row.kind === "viewer") {
    return [row.shellKey];
  }
  return row.shellKeys.length > 0
    ? [...row.shellKeys]
    : [getShellDragSourceId(row)];
}
