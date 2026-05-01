import type { TerminalRecord } from "@anyharness/sdk";
import { isApplePlatform } from "@/lib/domain/shortcuts/matching";
import type { RightPanelWorkspaceState } from "@/lib/domain/workspaces/right-panel";

export function orderTerminals(
  terminals: readonly TerminalRecord[],
  terminalOrder: readonly string[],
): TerminalRecord[] {
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const ordered: TerminalRecord[] = [];
  for (const terminalId of terminalOrder) {
    const terminal = byId.get(terminalId);
    if (terminal) {
      ordered.push(terminal);
      byId.delete(terminalId);
    }
  }
  ordered.push(...byId.values());
  return ordered;
}

export function rightPanelStateEqual(
  left: RightPanelWorkspaceState,
  right: RightPanelWorkspaceState,
): boolean {
  return left.activeTool === right.activeTool
    && left.activeTerminalId === right.activeTerminalId
    && arraysEqual(left.toolOrder, right.toolOrder)
    && arraysEqual(left.terminalOrder, right.terminalOrder)
    && arraysEqual(left.headerOrder, right.headerOrder);
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
