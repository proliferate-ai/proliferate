import type {
  TerminalDataFrame,
  TerminalReplayGapFrame,
} from "@anyharness/sdk";

const MAX_REPLAY_DATA_BYTES = 256 * 1024;
const MAX_REPLAY_ENTRIES = 1000;

export const TERMINAL_OUTPUT_GAP_MESSAGE =
  "[terminal output gap: earlier output was discarded]";

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

export interface TerminalReplayBuffer {
  lastDataSeq: number;
  nextOrder: number;
  replayEntries: TerminalReplayEntry[];
  replayDataBytes: number;
  overflowMarkedSinceReplay: boolean;
  listeners: Set<(entry: TerminalReplayEntry) => void>;
}

export function appendDataEntry(
  buffer: TerminalReplayBuffer,
  data: Uint8Array,
  frame: TerminalDataFrame,
): boolean {
  if (frame.seq <= buffer.lastDataSeq) {
    return false;
  }
  buffer.lastDataSeq = frame.seq;
  appendReplayEntry(buffer, {
    type: "data",
    order: nextOrder(buffer),
    seq: frame.seq,
    data,
  });
  return true;
}

export function appendRuntimeGapEntry(
  buffer: TerminalReplayBuffer,
  frame: TerminalReplayGapFrame,
): void {
  const replayEntry: TerminalReplayEntry = {
    type: "runtime-gap",
    order: nextOrder(buffer),
    requestedAfterSeq: frame.requestedAfterSeq,
    floorSeq: frame.floorSeq,
  };
  const insertIndex = buffer.replayEntries.findIndex((candidate) =>
    candidate.type === "data" && candidate.seq > frame.floorSeq
  );
  if (insertIndex >= 0) {
    buffer.replayEntries.splice(insertIndex, 0, replayEntry);
  } else {
    buffer.replayEntries.push(replayEntry);
  }
  trimReplayEntries(buffer);
  emitReplayEntry(buffer, replayEntry);
}

export function appendReplayEntry(
  buffer: TerminalReplayBuffer,
  replayEntry: TerminalReplayEntry,
): void {
  buffer.replayEntries.push(replayEntry);
  if (replayEntry.type === "data") {
    buffer.replayDataBytes += replayEntry.data.byteLength;
  }
  trimReplayEntries(buffer);
  emitReplayEntry(buffer, replayEntry);
}

export function appendExitEntry(
  buffer: TerminalReplayBuffer,
  code: number | null,
): void {
  appendReplayEntry(buffer, {
    type: "exit",
    order: nextOrder(buffer),
    afterSeq: buffer.lastDataSeq,
    code,
  });
}

function trimReplayEntries(buffer: TerminalReplayBuffer): void {
  let lostEntries = false;
  while (
    buffer.replayEntries.length > MAX_REPLAY_ENTRIES
    || buffer.replayDataBytes > MAX_REPLAY_DATA_BYTES
  ) {
    const removed = removeOldestReplayEntry(buffer);
    if (!removed) {
      break;
    }
    lostEntries = true;
    if (removed.type === "data") {
      buffer.replayDataBytes -= removed.data.byteLength;
    }
  }

  if (!lostEntries || buffer.overflowMarkedSinceReplay) {
    return;
  }

  while (buffer.replayEntries.length >= MAX_REPLAY_ENTRIES) {
    const removed = removeOldestReplayEntry(buffer);
    if (removed?.type === "data") {
      buffer.replayDataBytes -= removed.data.byteLength;
    }
  }

  buffer.replayEntries.unshift({
    type: "local-overflow",
    order: nextOrder(buffer),
  });
  buffer.overflowMarkedSinceReplay = true;
}

function removeOldestReplayEntry(
  buffer: TerminalReplayBuffer,
): TerminalReplayEntry | undefined {
  const removalIndex =
    buffer.overflowMarkedSinceReplay
    && buffer.replayEntries[0]?.type === "local-overflow"
    && buffer.replayEntries.length > 1
      ? 1
      : 0;
  const [removed] = buffer.replayEntries.splice(removalIndex, 1);
  return removed;
}

function emitReplayEntry(
  buffer: TerminalReplayBuffer,
  replayEntry: TerminalReplayEntry,
): void {
  for (const listener of buffer.listeners) {
    listener(replayEntry);
  }
}

function nextOrder(buffer: TerminalReplayBuffer): number {
  buffer.nextOrder += 1;
  return buffer.nextOrder;
}
