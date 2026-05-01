import {
  connectTerminal,
  type TerminalDataFrame,
  type TerminalReplayGapFrame,
  type TerminalStreamHandle,
} from "@anyharness/sdk";

const MAX_REPLAY_DATA_BYTES = 256 * 1024;
const MAX_REPLAY_ENTRIES = 1000;
export const TERMINAL_OUTPUT_GAP_MESSAGE = "[terminal output gap: earlier output was discarded]";

export interface TerminalStreamIdentity {
  workspaceId: string;
  terminalId: string;
  runtimeIdentity: string;
}

export type TerminalReplayEntry =
  | {
      type: "data";
      order: number;
      seq: number;
      data: Uint8Array;
    }
  | {
      type: "runtime-gap";
      order: number;
      requestedAfterSeq: number;
      floorSeq: number;
    }
  | {
      type: "local-overflow";
      order: number;
    }
  | {
      type: "exit";
      order: number;
      afterSeq: number;
      code: number | null;
    };

interface TerminalRegistryEntry {
  identity: TerminalStreamIdentity;
  handle: TerminalStreamHandle | null;
  lastDataSeq: number;
  nextOrder: number;
  replayEntries: TerminalReplayEntry[];
  replayDataBytes: number;
  overflowMarkedSinceReplay: boolean;
  readOnly: boolean;
  exited: boolean;
  exitCode: number | null;
  suppressLifecycleCallbacks: boolean;
  listeners: Set<(entry: TerminalReplayEntry) => void>;
}

interface EnsureConnectedOptions {
  identity: TerminalStreamIdentity;
  baseUrl: string;
  authToken?: string;
  readOnly?: boolean;
  onOpen?: () => void;
  onData?: (data: Uint8Array, frame: TerminalDataFrame) => void;
  onExit?: (code: number | null) => void;
  onReplayGap?: (frame: TerminalReplayGapFrame) => void;
  onError?: (error: Event) => void;
  onClose?: (event: CloseEvent) => void;
}

const registry = new Map<string, TerminalRegistryEntry>();

export function createTerminalRuntimeIdentity(input: {
  runtimeUrl: string;
  anyharnessWorkspaceId: string;
  runtimeGeneration?: number;
}): string {
  return [
    input.runtimeUrl.replace(/\/+$/, ""),
    input.anyharnessWorkspaceId,
    input.runtimeGeneration?.toString() ?? "",
  ].join("\u0000");
}

export function ensureConnected(options: EnsureConnectedOptions): boolean {
  const entry = getOrCreateEntry(options.identity);
  if (options.readOnly) {
    entry.readOnly = true;
  }
  if (entry.exited || entry.handle) {
    return false;
  }

  const handle = connectTerminal({
    baseUrl: options.baseUrl,
    authToken: options.authToken,
    terminalId: options.identity.terminalId,
    afterSeq: entry.lastDataSeq > 0 ? entry.lastDataSeq : undefined,
    onOpen: options.onOpen,
    onData: (data, frame) => {
      if (entry.suppressLifecycleCallbacks) {
        return;
      }
      if (!appendDataEntry(entry, data, frame)) {
        return;
      }
      options.onData?.(data, frame);
    },
    onReplayGap: (frame) => {
      if (entry.suppressLifecycleCallbacks) {
        return;
      }
      appendRuntimeGapEntry(entry, frame);
      options.onReplayGap?.(frame);
    },
    onExit: (code) => {
      if (entry.suppressLifecycleCallbacks) {
        return;
      }
      markExited(options.identity, code);
      options.onExit?.(code);
    },
    onError: (event) => {
      if (entry.suppressLifecycleCallbacks) {
        return;
      }
      forgetHandle(options.identity);
      options.onError?.(event);
    },
    onClose: (event) => {
      if (entry.suppressLifecycleCallbacks) {
        return;
      }
      forgetHandle(options.identity);
      options.onClose?.(event);
    },
  });
  entry.handle = handle;
  return true;
}

export function subscribeWithReplay(
  identity: TerminalStreamIdentity,
  listener: (entry: TerminalReplayEntry) => void,
): () => void {
  const entry = getOrCreateEntry(identity);
  const replayEntries = [...entry.replayEntries];
  for (const replayEntry of replayEntries) {
    listener(replayEntry);
  }
  entry.overflowMarkedSinceReplay = false;
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

export function adoptTerminalStreamIdentity(identity: TerminalStreamIdentity): void {
  for (const [key, entry] of registry.entries()) {
    if (
      entry.identity.workspaceId === identity.workspaceId
      && entry.identity.terminalId === identity.terminalId
      && entry.identity.runtimeIdentity !== identity.runtimeIdentity
    ) {
      closeAndDeleteEntry(key, entry);
    }
  }
}

export function sendInput(identity: TerminalStreamIdentity, data: string | Uint8Array): void {
  const entry = registry.get(streamKey(identity));
  if (!entry || entry.exited || entry.readOnly) {
    return;
  }
  entry.handle?.send(data);
}

export function sendResize(
  identity: TerminalStreamIdentity,
  cols: number,
  rows: number,
): void {
  const entry = registry.get(streamKey(identity));
  if (!entry || entry.exited || entry.readOnly) {
    return;
  }
  entry.handle?.sendResize(cols, rows);
}

export function markReadOnly(identity: TerminalStreamIdentity): void {
  getOrCreateEntry(identity).readOnly = true;
}

export function markExited(identity: TerminalStreamIdentity, code: number | null = null): void {
  const entry = getOrCreateEntry(identity);
  activelyCloseHandle(entry);
  if (entry.exited) {
    return;
  }
  entry.exited = true;
  entry.exitCode = code;
  appendReplayEntry(entry, {
    type: "exit",
    order: nextOrder(entry),
    afterSeq: entry.lastDataSeq,
    code,
  });
}

export function clearTerminal(input: {
  workspaceId: string;
  terminalId: string;
}): void {
  for (const [key, entry] of registry.entries()) {
    if (
      entry.identity.workspaceId === input.workspaceId
      && entry.identity.terminalId === input.terminalId
    ) {
      closeAndDeleteEntry(key, entry);
    }
  }
}

export function clearForRuntime(runtimeIdentity: string): void {
  for (const [key, entry] of registry.entries()) {
    if (entry.identity.runtimeIdentity === runtimeIdentity) {
      closeAndDeleteEntry(key, entry);
    }
  }
}

export function hasActiveHandle(identity: TerminalStreamIdentity): boolean {
  return Boolean(registry.get(streamKey(identity))?.handle);
}

export function getLastDataSeq(identity: TerminalStreamIdentity): number {
  return registry.get(streamKey(identity))?.lastDataSeq ?? 0;
}

export function resetTerminalStreamRegistryForTests(): void {
  for (const entry of registry.values()) {
    activelyCloseHandle(entry);
  }
  registry.clear();
}

function getOrCreateEntry(identity: TerminalStreamIdentity): TerminalRegistryEntry {
  const key = streamKey(identity);
  const existing = registry.get(key);
  if (existing) {
    return existing;
  }
  const entry: TerminalRegistryEntry = {
    identity,
    handle: null,
    lastDataSeq: 0,
    nextOrder: 0,
    replayEntries: [],
    replayDataBytes: 0,
    overflowMarkedSinceReplay: false,
    readOnly: false,
    exited: false,
    exitCode: null,
    suppressLifecycleCallbacks: false,
    listeners: new Set(),
  };
  registry.set(key, entry);
  return entry;
}

function appendDataEntry(
  entry: TerminalRegistryEntry,
  data: Uint8Array,
  frame: TerminalDataFrame,
): boolean {
  if (frame.seq <= entry.lastDataSeq) {
    return false;
  }
  entry.lastDataSeq = frame.seq;
  appendReplayEntry(entry, {
    type: "data",
    order: nextOrder(entry),
    seq: frame.seq,
    data,
  });
  return true;
}

function appendRuntimeGapEntry(
  entry: TerminalRegistryEntry,
  frame: TerminalReplayGapFrame,
): void {
  const replayEntry: TerminalReplayEntry = {
    type: "runtime-gap",
    order: nextOrder(entry),
    requestedAfterSeq: frame.requestedAfterSeq,
    floorSeq: frame.floorSeq,
  };
  const insertIndex = entry.replayEntries.findIndex((candidate) =>
    candidate.type === "data" && candidate.seq > frame.floorSeq
  );
  if (insertIndex >= 0) {
    entry.replayEntries.splice(insertIndex, 0, replayEntry);
  } else {
    entry.replayEntries.push(replayEntry);
  }
  trimReplayEntries(entry);
  emitReplayEntry(entry, replayEntry);
}

function appendReplayEntry(
  entry: TerminalRegistryEntry,
  replayEntry: TerminalReplayEntry,
): void {
  entry.replayEntries.push(replayEntry);
  if (replayEntry.type === "data") {
    entry.replayDataBytes += replayEntry.data.byteLength;
  }
  trimReplayEntries(entry);
  emitReplayEntry(entry, replayEntry);
}

function trimReplayEntries(entry: TerminalRegistryEntry): void {
  let lostEntries = false;
  while (
    entry.replayEntries.length > MAX_REPLAY_ENTRIES
    || entry.replayDataBytes > MAX_REPLAY_DATA_BYTES
  ) {
    const removed = removeOldestReplayEntry(entry);
    if (!removed) {
      break;
    }
    lostEntries = true;
    if (removed.type === "data") {
      entry.replayDataBytes -= removed.data.byteLength;
    }
  }

  if (!lostEntries || entry.overflowMarkedSinceReplay) {
    return;
  }

  while (entry.replayEntries.length >= MAX_REPLAY_ENTRIES) {
    const removed = removeOldestReplayEntry(entry);
    if (removed?.type === "data") {
      entry.replayDataBytes -= removed.data.byteLength;
    }
  }

  entry.replayEntries.unshift({
    type: "local-overflow",
    order: nextOrder(entry),
  });
  entry.overflowMarkedSinceReplay = true;
}

function removeOldestReplayEntry(
  entry: TerminalRegistryEntry,
): TerminalReplayEntry | undefined {
  const removalIndex =
    entry.overflowMarkedSinceReplay
    && entry.replayEntries[0]?.type === "local-overflow"
    && entry.replayEntries.length > 1
      ? 1
      : 0;
  const [removed] = entry.replayEntries.splice(removalIndex, 1);
  return removed;
}

function emitReplayEntry(
  entry: TerminalRegistryEntry,
  replayEntry: TerminalReplayEntry,
): void {
  for (const listener of entry.listeners) {
    listener(replayEntry);
  }
}

function forgetHandle(identity: TerminalStreamIdentity): void {
  const entry = registry.get(streamKey(identity));
  if (entry) {
    entry.handle = null;
  }
}

function activelyCloseHandle(entry: TerminalRegistryEntry): void {
  const handle = entry.handle;
  entry.suppressLifecycleCallbacks = true;
  entry.handle = null;
  handle?.close();
}

function closeAndDeleteEntry(key: string, entry: TerminalRegistryEntry): void {
  activelyCloseHandle(entry);
  entry.listeners.clear();
  registry.delete(key);
}

function nextOrder(entry: TerminalRegistryEntry): number {
  entry.nextOrder += 1;
  return entry.nextOrder;
}

function streamKey(identity: TerminalStreamIdentity): string {
  return [
    identity.workspaceId,
    identity.terminalId,
    identity.runtimeIdentity,
  ].join("\u0000");
}
