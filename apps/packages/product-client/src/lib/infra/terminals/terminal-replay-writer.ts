import {
  TERMINAL_OUTPUT_GAP_MESSAGE,
  type TerminalReplayEntry,
} from "#product/lib/infra/terminals/terminal-stream-registry";

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

  const flush = () => {
    frameHandle = null;
    const entries = pendingEntries;
    pendingEntries = [];
    if (entries.length === 0) {
      return;
    }
    terminal.write(joinReplayEntries(entries));
    onFlush?.(entries);
  };

  return {
    enqueue(entry) {
      pendingEntries.push(entry);
      frameHandle ??= scheduler.request(flush);
    },
    dispose() {
      if (frameHandle !== null) {
        scheduler.cancel(frameHandle);
        frameHandle = null;
      }
      pendingEntries = [];
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
