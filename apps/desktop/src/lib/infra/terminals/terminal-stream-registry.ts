import {
  connectTerminal,
  type TerminalDataFrame,
  type TerminalReplayGapFrame,
  type TerminalStreamHandle,
  type TerminalWebSocketAuthTransport,
} from "@anyharness/sdk";
import { terminalStreamKey } from "./terminal-stream-key";
import { resetTerminalCloseIntentForTests } from "./terminal-close-intent";
import {
  appendDataEntry,
  appendExitEntry,
  appendRuntimeGapEntry,
  type TerminalReplayBuffer,
  type TerminalReplayEntry,
} from "./terminal-replay-buffer";

export interface TerminalStreamIdentity {
  workspaceId: string;
  terminalId: string;
  runtimeIdentity: string;
  /** Credential-free authority that owns a cloud terminal stream. */
  cloudAuthorityScopeKey?: string;
}

interface TerminalRegistryEntry extends TerminalReplayBuffer {
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
  webSocketAuthTransport?: TerminalWebSocketAuthTransport;
  readOnly?: boolean;
  onOpen?: () => void;
  onData?: (data: Uint8Array, frame: TerminalDataFrame) => void;
  onExit?: (code: number | null) => void;
  onReplayGap?: (frame: TerminalReplayGapFrame) => void;
  onError?: (error: Event) => void;
  onClose?: (event: CloseEvent) => void;
}

const registry = new Map<string, TerminalRegistryEntry>();

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
    webSocketAuthTransport: options.webSocketAuthTransport,
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
      && (
        entry.identity.runtimeIdentity !== identity.runtimeIdentity
        || normalizeCloudAuthorityScopeKey(entry.identity)
          !== normalizeCloudAuthorityScopeKey(identity)
      )
    ) {
      closeAndDeleteEntry(key, entry);
    }
  }
}

/**
 * Retire cloud terminal handles that belong to a superseded ProductHost
 * authority. Local and direct-target handles have no cloud authority scope and
 * deliberately survive cloud login or deployment changes.
 */
export function retireCloudTerminalStreamsOutsideAuthority(
  cloudAuthorityScopeKey: string,
): void {
  for (const [key, entry] of registry.entries()) {
    const entryAuthorityScopeKey = normalizeCloudAuthorityScopeKey(entry.identity);
    if (
      entryAuthorityScopeKey !== null
      && entryAuthorityScopeKey !== cloudAuthorityScopeKey
    ) {
      closeAndDeleteEntry(key, entry);
    }
  }
}

export function sendInput(identity: TerminalStreamIdentity, data: string | Uint8Array): void {
  const entry = registry.get(terminalStreamKey(identity));
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
  const entry = registry.get(terminalStreamKey(identity));
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
  appendExitEntry(entry, code);
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
  return Boolean(registry.get(terminalStreamKey(identity))?.handle);
}

export function getLastDataSeq(identity: TerminalStreamIdentity): number {
  return registry.get(terminalStreamKey(identity))?.lastDataSeq ?? 0;
}

export function resetTerminalStreamRegistryForTests(): void {
  for (const entry of registry.values()) {
    activelyCloseHandle(entry);
  }
  registry.clear();
  resetTerminalCloseIntentForTests();
}

function getOrCreateEntry(identity: TerminalStreamIdentity): TerminalRegistryEntry {
  const key = terminalStreamKey(identity);
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

function forgetHandle(identity: TerminalStreamIdentity): void {
  const entry = registry.get(terminalStreamKey(identity));
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

function normalizeCloudAuthorityScopeKey(
  identity: TerminalStreamIdentity,
): string | null {
  return identity.cloudAuthorityScopeKey ?? null;
}
