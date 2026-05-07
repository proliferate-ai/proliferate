import type { TerminalRecord } from "@anyharness/sdk";
import { isApplePlatform } from "@/lib/domain/shortcuts/matching";
import {
  browserIdsFromHeaderOrder,
  terminalIdsFromHeaderOrder,
  type RightPanelBrowserTab,
  type RightPanelHeaderEntryKey,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel";

export function orderTerminals(
  terminals: readonly TerminalRecord[],
  headerOrder: readonly RightPanelHeaderEntryKey[],
): TerminalRecord[] {
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const ordered: TerminalRecord[] = [];
  for (const terminalId of terminalIdsFromHeaderOrder(headerOrder)) {
    const terminal = byId.get(terminalId);
    if (terminal) {
      ordered.push(terminal);
      byId.delete(terminalId);
    }
  }
  ordered.push(...byId.values());
  return ordered;
}

export function orderBrowserTabs(
  tabsById: Record<string, RightPanelBrowserTab>,
  headerOrder: readonly RightPanelHeaderEntryKey[],
): RightPanelBrowserTab[] {
  return browserIdsFromHeaderOrder(headerOrder)
    .map((browserId) => tabsById[browserId])
    .filter((tab): tab is RightPanelBrowserTab => Boolean(tab));
}

export function rightPanelStateEqual(
  left: RightPanelWorkspaceState,
  right: RightPanelWorkspaceState,
): boolean {
  return left.activeEntryKey === right.activeEntryKey
    && arraysEqual(left.headerOrder, right.headerOrder)
    && browserTabsEqual(left.browserTabsById, right.browserTabsById);
}

export function resolvePrimaryDigitShortcutIndex(event: KeyboardEvent): number | null {
  if (event.shiftKey || event.altKey) {
    return null;
  }

  const isApple = isApplePlatform();
  const hasPrimaryModifier = isApple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!hasPrimaryModifier) {
    return null;
  }

  const keyDigit = /^[1-9]$/.test(event.key) ? Number.parseInt(event.key, 10) : null;
  const codeMatch = /^Digit([1-9])$/.exec(event.code);
  const codeDigit = codeMatch ? Number.parseInt(codeMatch[1]!, 10) : null;
  const digit = keyDigit ?? codeDigit;
  return digit ? digit - 1 : null;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function browserTabsEqual(
  left: Record<string, RightPanelBrowserTab>,
  right: Record<string, RightPanelBrowserTab>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return arraysEqual(leftKeys.sort(), rightKeys.sort())
    && leftKeys.every((key) => left[key]?.url === right[key]?.url);
}
