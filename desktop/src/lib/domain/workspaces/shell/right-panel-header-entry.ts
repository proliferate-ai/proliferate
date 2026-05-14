import type { TerminalRecord } from "@anyharness/sdk";
import {
  type RightPanelBrowserTab,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import { browserTabTitle } from "@/lib/domain/workspaces/shell/right-panel-browser-tabs";
import type { ViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";

export type RightPanelHeaderEntry =
  | { kind: "tool"; key: RightPanelHeaderEntryKey; tool: RightPanelTool }
  | {
    kind: "terminal";
    key: RightPanelHeaderEntryKey;
    terminalId: string;
    terminal: TerminalRecord | null;
  }
  | { kind: "browser"; key: RightPanelHeaderEntryKey; tab: RightPanelBrowserTab }
  | { kind: "viewer"; key: RightPanelHeaderEntryKey; target: ViewerTarget };

export function terminalHeaderDisplayTitle(
  entries: readonly RightPanelHeaderEntry[],
  entry: Extract<RightPanelHeaderEntry, { kind: "terminal" }>,
): string {
  const terminalIndex = entries
    .filter((candidate) => candidate.kind === "terminal")
    .findIndex((candidate) =>
      candidate.kind === "terminal" && candidate.terminalId === entry.terminalId
    );
  const fallbackTitle = `Terminal ${terminalIndex + 1}`;
  return entry.terminal?.title === "Terminal"
    ? fallbackTitle
    : entry.terminal?.title ?? fallbackTitle;
}

export function browserHeaderDisplayTitle(
  entries: readonly RightPanelHeaderEntry[],
  entry: Extract<RightPanelHeaderEntry, { kind: "browser" }>,
): string {
  const browserIndex = entries
    .filter((candidate) => candidate.kind === "browser")
    .findIndex((candidate) =>
      candidate.kind === "browser" && candidate.tab.id === entry.tab.id
    );
  return browserTabTitle(entry.tab, browserIndex);
}
