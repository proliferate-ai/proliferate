const MAX_REPLAY_DATA_BYTES = 256 * 1024;
const MAX_REPLAY_ENTRIES = 1000;

export const TERMINAL_OUTPUT_GAP_MESSAGE = "[terminal output gap: earlier output was discarded]";

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

interface TerminalReplayBufferState {
  nextOrder: number;
  replayEntries: TerminalReplayEntry[];
  replayDataBytes: number;
  replayFloorOrder: number;
  overflowMarkedSinceReplay: boolean;
}

export function nextTerminalReplayOrder(entry: Pick<TerminalReplayBufferState, "nextOrder">) {
  entry.nextOrder += 1;
  return entry.nextOrder;
}

export function trimTerminalReplayEntries(entry: TerminalReplayBufferState): void {
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
    recordRemovedEntry(entry, removed);
  }

  if (!lostEntries || entry.overflowMarkedSinceReplay) {
    return;
  }

  while (entry.replayEntries.length >= MAX_REPLAY_ENTRIES) {
    const removed = removeOldestReplayEntry(entry);
    if (removed) {
      recordRemovedEntry(entry, removed);
    }
  }

  entry.replayEntries.unshift({
    type: "local-overflow",
    order: nextTerminalReplayOrder(entry),
  });
  entry.overflowMarkedSinceReplay = true;
}

function recordRemovedEntry(
  entry: TerminalReplayBufferState,
  removed: TerminalReplayEntry,
): void {
  if (removed.type !== "local-overflow") {
    entry.replayFloorOrder = Math.max(entry.replayFloorOrder, removed.order);
  }
  if (removed.type === "data") {
    entry.replayDataBytes -= removed.data.byteLength;
  }
}

function removeOldestReplayEntry(
  entry: TerminalReplayBufferState,
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
