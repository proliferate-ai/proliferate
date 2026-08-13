// Bounded record queue behind the renderer batcher.
//
// Two budgets apply at once: a hard queue ceiling covering every pending record,
// and a smaller ordinary lane so a flood of low-severity records can never
// starve warn/error records of headroom. Records handed to the collector are
// tracked separately as "detached" but still count against both budgets, so an
// in-flight batch cannot be double-spent.

import type { Acknowledgement } from "./renderer-diagnostics-batcher-waiters";
import type { RendererLossRecord, RendererLossSnapshot } from "./renderer-diagnostics-batcher-limits";
import {
  RENDERER_BATCH_BYTE_LIMIT,
  RENDERER_BATCH_ENVELOPE_BYTES,
  RENDERER_BATCH_RECORD_LIMIT,
  RENDERER_ORDINARY_BYTE_LIMIT,
  RENDERER_ORDINARY_RECORD_LIMIT,
  RENDERER_QUEUE_BYTE_LIMIT,
  RENDERER_QUEUE_RECORD_LIMIT,
} from "./renderer-diagnostics-batcher-limits";

export interface QueuedRecord extends RendererLossRecord {
  priority: boolean;
  acknowledgement?: Acknowledgement;
  lossSnapshot?: RendererLossSnapshot;
}

export interface QueueAdmission {
  admitted: boolean;
  // Ordinary records evicted to make room for a priority record. The caller
  // still has to account for these even when admission ultimately failed.
  evicted: QueuedRecord[];
}

export class RendererRecordQueue {
  private readonly entries: QueuedRecord[] = [];
  private queuedBytes = 0;
  private detachedInFlight: QueuedRecord[] | null = null;
  private detachedBytes = 0;

  get length(): number {
    return this.entries.length;
  }

  get bytes(): number {
    return this.queuedBytes;
  }

  get inFlightRecords(): number {
    return this.detachedInFlight?.length ?? 0;
  }

  get inFlightBytes(): number {
    return this.detachedBytes;
  }

  totalRecords(): number {
    return this.entries.length + this.inFlightRecords;
  }

  totalBytes(): number {
    return this.queuedBytes + this.detachedBytes;
  }

  sequences(): number[] {
    return this.entries.map((entry) => entry.record.producer_sequence);
  }

  admit(entry: QueuedRecord): QueueAdmission {
    const evicted: QueuedRecord[] = [];
    if (
      entry.serializedBytes > RENDERER_QUEUE_BYTE_LIMIT
      || (!entry.priority && !this.ordinaryLaneCanAdmit(entry.serializedBytes))
    ) {
      return { admitted: false, evicted };
    }

    if (entry.priority) {
      while (!this.hasHeadroomFor(entry.serializedBytes)) {
        if (this.entries.length === 0) {
          return { admitted: false, evicted };
        }
        const evictionIndex = this.entries.findIndex((queued) => !queued.priority);
        const dropped = this.removeAt(evictionIndex >= 0 ? evictionIndex : 0);
        if (dropped !== undefined) {
          evicted.push(dropped);
        }
      }
    } else if (!this.hasHeadroomFor(entry.serializedBytes)) {
      return { admitted: false, evicted };
    }

    this.entries.push(entry);
    this.queuedBytes += entry.serializedBytes;
    return { admitted: true, evicted };
  }

  detachBatch(): QueuedRecord[] {
    const detached: QueuedRecord[] = [];
    let bytes = RENDERER_BATCH_ENVELOPE_BYTES;
    while (this.entries.length > 0 && detached.length < RENDERER_BATCH_RECORD_LIMIT) {
      const next = this.entries[0];
      const separatorBytes = detached.length === 0 ? 0 : 1;
      if (
        detached.length > 0
        && bytes + separatorBytes + next.serializedBytes > RENDERER_BATCH_BYTE_LIMIT
      ) {
        break;
      }
      this.entries.shift();
      this.queuedBytes -= next.serializedBytes;
      detached.push(next);
      bytes += separatorBytes + next.serializedBytes;
    }
    this.detachedInFlight = detached;
    this.detachedBytes = detached.reduce(
      (total, entry) => total + entry.serializedBytes,
      0,
    );
    return detached;
  }

  releaseDetached(detached: QueuedRecord[]): void {
    if (this.detachedInFlight !== detached) {
      return;
    }
    this.detachedInFlight = null;
    this.detachedBytes = 0;
  }

  private hasHeadroomFor(bytes: number): boolean {
    return this.totalRecords() < RENDERER_QUEUE_RECORD_LIMIT
      && this.totalBytes() + bytes <= RENDERER_QUEUE_BYTE_LIMIT;
  }

  private ordinaryLaneCanAdmit(bytes: number): boolean {
    let ordinaryRecords = 0;
    let ordinaryBytes = 0;
    for (const entry of this.pendingEntries()) {
      if (!entry.priority) {
        ordinaryRecords += 1;
        ordinaryBytes += entry.serializedBytes;
      }
    }
    return ordinaryRecords < RENDERER_ORDINARY_RECORD_LIMIT
      && ordinaryBytes + bytes <= RENDERER_ORDINARY_BYTE_LIMIT;
  }

  private pendingEntries(): readonly QueuedRecord[] {
    return this.detachedInFlight === null
      ? this.entries
      : [...this.detachedInFlight, ...this.entries];
  }

  private removeAt(index: number): QueuedRecord | undefined {
    const [dropped] = this.entries.splice(index, 1);
    if (dropped === undefined) {
      return undefined;
    }
    this.queuedBytes -= dropped.serializedBytes;
    return dropped;
  }
}
