import { useMemo } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import {
  availableRightPanelTools,
  parseRightPanelHeaderEntryKey,
  terminalIdsFromHeaderOrder,
  type RightPanelHeaderEntryKey,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  orderTerminals,
} from "@/lib/domain/workspaces/shell/right-panel-view";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import {
  viewerTargetKey,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";

export interface RightPanelHeaderEntriesState {
  activeEntry: ReturnType<typeof parseRightPanelHeaderEntryKey>;
  activeTool: Extract<ReturnType<typeof parseRightPanelHeaderEntryKey>, { kind: "tool" }>["tool"]
    | null;
  activeTerminalId: string | null;
  activeViewerTarget: ViewerTarget | null;
  visibleTerminals: TerminalRecord[];
  orderedTerminals: TerminalRecord[];
  headerEntries: RightPanelHeaderEntry[];
}

export function useRightPanelHeaderEntries({
  state,
  terminals,
  openViewerTargets,
  isCloudWorkspaceSelected,
}: {
  state: RightPanelWorkspaceState;
  terminals: readonly TerminalRecord[];
  openViewerTargets: readonly ViewerTarget[];
  isCloudWorkspaceSelected: boolean;
}): RightPanelHeaderEntriesState {
  const terminalIdsInHeader = useMemo(
    () => new Set(terminalIdsFromHeaderOrder(state.headerOrder)),
    [state.headerOrder],
  );
  const visibleTerminals = useMemo(
    () => terminals.filter((terminal) =>
      terminal.purpose !== "setup" || terminalIdsInHeader.has(terminal.id)
    ),
    [terminalIdsInHeader, terminals],
  );
  const terminalById = useMemo(
    () => new Map(visibleTerminals.map((terminal) => [terminal.id, terminal])),
    [visibleTerminals],
  );
  const orderedTerminals = useMemo(
    () => orderTerminals(visibleTerminals, state.headerOrder),
    [state.headerOrder, visibleTerminals],
  );
  const activeEntry = useMemo(
    () => parseRightPanelHeaderEntryKey(state.activeEntryKey),
    [state.activeEntryKey],
  );
  const viewerTargetByKey = useMemo(
    () => new Map(openViewerTargets.map((target) => [viewerTargetKey(target), target])),
    [openViewerTargets],
  );
  const headerEntries = useMemo<RightPanelHeaderEntry[]>(() => {
    const entries: RightPanelHeaderEntry[] = [];
    const seenKeys = new Set<RightPanelHeaderEntryKey>();
    const availableToolSet = new Set(availableRightPanelTools(isCloudWorkspaceSelected));

    for (const key of state.headerOrder) {
      const entry = parseRightPanelHeaderEntryKey(key);
      if (!entry || seenKeys.has(key)) {
        continue;
      }
      if (entry.kind === "tool" && availableToolSet.has(entry.tool)) {
        entries.push({ kind: "tool", key, tool: entry.tool });
        seenKeys.add(key);
      }
      if (entry.kind === "terminal") {
        entries.push({
          kind: "terminal",
          key,
          terminalId: entry.terminalId,
          terminal: terminalById.get(entry.terminalId) ?? null,
        });
        seenKeys.add(key);
      }
      if (entry.kind === "viewer") {
        const target = viewerTargetByKey.get(entry.targetKey);
        if (target && target.kind !== "allChanges") {
          entries.push({ kind: "viewer", key: entry.targetKey, target });
          seenKeys.add(entry.targetKey);
        }
      }
    }

    return entries;
  }, [
    isCloudWorkspaceSelected,
    state.headerOrder,
    terminalById,
    viewerTargetByKey,
  ]);

  const activeTool = activeEntry?.kind === "tool" ? activeEntry.tool : null;
  const activeTerminalId = activeEntry?.kind === "terminal" ? activeEntry.terminalId : null;
  const activeViewerTarget = activeEntry?.kind === "viewer"
    ? viewerTargetByKey.get(activeEntry.targetKey) ?? null
    : null;

  return {
    activeEntry,
    activeTool,
    activeTerminalId,
    activeViewerTarget,
    visibleTerminals,
    orderedTerminals,
    headerEntries,
  };
}
