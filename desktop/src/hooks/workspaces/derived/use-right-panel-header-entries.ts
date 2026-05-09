import { useMemo } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import {
  availableRightPanelTools,
  parseRightPanelHeaderEntryKey,
  terminalIdsFromHeaderOrder,
  type RightPanelHeaderEntryKey,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import { canCreateRightPanelBrowserTab } from "@/lib/domain/workspaces/shell/right-panel-state";
import {
  orderBrowserTabs,
  orderTerminals,
} from "@/lib/domain/workspaces/shell/right-panel-view";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";

export interface RightPanelHeaderEntriesState {
  activeEntry: ReturnType<typeof parseRightPanelHeaderEntryKey>;
  activeTool: Extract<ReturnType<typeof parseRightPanelHeaderEntryKey>, { kind: "tool" }>["tool"]
    | null;
  activeTerminalId: string | null;
  activeBrowserId: string | null;
  visibleTerminals: TerminalRecord[];
  orderedTerminals: TerminalRecord[];
  browserTabs: ReturnType<typeof orderBrowserTabs>;
  canCreateBrowserTab: boolean;
  headerEntries: RightPanelHeaderEntry[];
}

export function useRightPanelHeaderEntries({
  state,
  terminals,
  isCloudWorkspaceSelected,
}: {
  state: RightPanelWorkspaceState;
  terminals: readonly TerminalRecord[];
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
  const browserTabs = useMemo(
    () => orderBrowserTabs(state.browserTabsById, state.headerOrder),
    [state.browserTabsById, state.headerOrder],
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
      if (entry.kind === "browser") {
        const tab = state.browserTabsById[entry.browserId];
        if (tab) {
          entries.push({ kind: "browser", key, tab });
          seenKeys.add(key);
        }
      }
    }

    return entries;
  }, [isCloudWorkspaceSelected, state.browserTabsById, state.headerOrder, terminalById]);

  const activeTool = activeEntry?.kind === "tool" ? activeEntry.tool : null;
  const activeTerminalId = activeEntry?.kind === "terminal" ? activeEntry.terminalId : null;
  const activeBrowserId = activeEntry?.kind === "browser" ? activeEntry.browserId : null;

  return {
    activeEntry,
    activeTool,
    activeTerminalId,
    activeBrowserId,
    visibleTerminals,
    orderedTerminals,
    browserTabs,
    canCreateBrowserTab: canCreateRightPanelBrowserTab(state),
    headerEntries,
  };
}
