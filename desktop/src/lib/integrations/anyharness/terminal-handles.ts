import type { TerminalStreamHandle } from "@anyharness/sdk";

const wsHandles: Record<string, TerminalStreamHandle> = {};
const dataListeners: Record<string, Set<(data: Uint8Array) => void>> = {};

export function getTerminalWsHandle(terminalId: string): TerminalStreamHandle | undefined {
  return wsHandles[terminalId];
}

export function setTerminalWsHandle(terminalId: string, handle: TerminalStreamHandle): void {
  if (wsHandles[terminalId]) wsHandles[terminalId].close();
  wsHandles[terminalId] = handle;
}

export function clearTerminalWsHandle(terminalId: string): void {
  if (wsHandles[terminalId]) {
    wsHandles[terminalId].close();
    delete wsHandles[terminalId];
  }
}

export function onTerminalData(
  terminalId: string,
  listener: (data: Uint8Array) => void,
): () => void {
  if (!dataListeners[terminalId]) {
    dataListeners[terminalId] = new Set();
  }
  dataListeners[terminalId].add(listener);
  return () => {
    dataListeners[terminalId]?.delete(listener);
  };
}

export function emitTerminalData(terminalId: string, data: Uint8Array): void {
  const listeners = dataListeners[terminalId];
  if (!listeners) return;
  for (const listener of listeners) {
    listener(data);
  }
}
