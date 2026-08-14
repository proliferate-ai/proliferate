import {
  TERMINAL_OUTPUT_GAP_MESSAGE,
  TERMINAL_REPLAY_MAX_DATA_BYTES,
  TERMINAL_REPLAY_MAX_ENTRIES,
  type TerminalReplayEntry,
} from "#product/lib/infra/terminals/terminal-replay-buffer";

interface TerminalWriteTarget {
  write(data: Uint8Array): void;
}

interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

const textEncoder = new TextEncoder();

export interface TerminalReplayWriter {
  enqueue(entry: TerminalReplayEntry): void;
  dispose(): void;
}

export function createTerminalReplayWriter(
  terminal: TerminalWriteTarget,
  scheduler: FrameScheduler = browserFrameScheduler,
  onFlush?: (entries: readonly TerminalReplayEntry[]) => void,
): TerminalReplayWriter {
  let frameHandle: number | null = null;
  let pendingEntries: TerminalReplayEntry[] = [];
  let pendingDataBytes = 0;
  let outputGapRequired = false;
  let overflowMarkerOrder = 0;

  const flush = () => {
    frameHandle = null;
    const queuedEntries = pendingEntries;
    pendingEntries = [];
    pendingDataBytes = 0;
    const entries: TerminalReplayEntry[] = outputGapRequired
      && queuedEntries[0]?.type !== "local-overflow"
      ? [{ type: "local-overflow", order: overflowMarkerOrder }, ...queuedEntries]
      : queuedEntries;
    outputGapRequired = false;
    overflowMarkerOrder = 0;
    if (entries.length === 0) {
      return;
    }
    terminal.write(joinReplayEntries(entries));
    onFlush?.(entries);
  };

  return {
    enqueue(entry) {
      pendingEntries.push(entry);
      if (entry.type === "data") {
        pendingDataBytes += entry.data.byteLength;
      }
      while (
        pendingEntries.length > TERMINAL_REPLAY_MAX_ENTRIES
        || pendingDataBytes > TERMINAL_REPLAY_MAX_DATA_BYTES
      ) {
        const removed = pendingEntries.shift();
        if (!removed) {
          break;
        }
        outputGapRequired = true;
        overflowMarkerOrder = Math.max(overflowMarkerOrder, removed.order);
        if (removed.type === "data") {
          pendingDataBytes -= removed.data.byteLength;
        }
      }
      frameHandle ??= scheduler.request(flush);
    },
    dispose() {
      if (frameHandle !== null) {
        scheduler.cancel(frameHandle);
        frameHandle = null;
      }
      pendingEntries = [];
      pendingDataBytes = 0;
      outputGapRequired = false;
      overflowMarkerOrder = 0;
    },
  };
}

function joinReplayEntries(entries: readonly TerminalReplayEntry[]): Uint8Array {
  const chunks = entries.map(replayEntryBytes);
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function replayEntryBytes(entry: TerminalReplayEntry): Uint8Array {
  if (entry.type === "data") {
    return entry.data;
  }
  if (entry.type === "runtime-gap" || entry.type === "local-overflow") {
    return textEncoder.encode(`\r\n${TERMINAL_OUTPUT_GAP_MESSAGE}\r\n`);
  }
  return textEncoder.encode("\r\n");
}

const browserFrameScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};
