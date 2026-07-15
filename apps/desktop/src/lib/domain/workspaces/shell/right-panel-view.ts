import type { TerminalRecord } from "@anyharness/sdk";
import {
  terminalIdsFromHeaderOrder,
  type RightPanelHeaderEntryKey,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";

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

export function rightPanelStateEqual(
  left: RightPanelWorkspaceState,
  right: RightPanelWorkspaceState,
): boolean {
  return left.activeEntryKey === right.activeEntryKey
    && arraysEqual(left.headerOrder, right.headerOrder);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
