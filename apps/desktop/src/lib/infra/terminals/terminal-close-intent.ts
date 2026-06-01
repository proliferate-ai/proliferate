const intentionallyClosingTerminalIds = new Set<string>();

export function markTerminalIntentionalClose(terminalId: string): void {
  intentionallyClosingTerminalIds.add(terminalId);
}

export function clearTerminalIntentionalClose(terminalId: string): void {
  intentionallyClosingTerminalIds.delete(terminalId);
}

export function isTerminalIntentionalClose(terminalId: string): boolean {
  return intentionallyClosingTerminalIds.has(terminalId);
}

export function resetTerminalCloseIntentForTests(): void {
  intentionallyClosingTerminalIds.clear();
}
