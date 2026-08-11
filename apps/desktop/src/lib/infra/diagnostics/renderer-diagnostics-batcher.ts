import type {
  IngestBatchV1,
  IngestReceiptV1,
  PressureV1,
  ProducerRecordV1,
  SeverityV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import { isRendererIngestProtocolError } from "./renderer-diagnostics-native-error";

export const RENDERER_QUEUE_RECORD_LIMIT = 256;
export const RENDERER_QUEUE_BYTE_LIMIT = 524_288;
export const RENDERER_ORDINARY_RECORD_LIMIT = 224;
export const RENDERER_ORDINARY_BYTE_LIMIT = 458_752;
export const RENDERER_BATCH_RECORD_LIMIT = 64;
export const RENDERER_BATCH_BYTE_LIMIT = 262_144;
export const RENDERER_FLUSH_INTERVAL_MS = 50;
export const RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS = 500;

const LOSS_REASONS = [
  "invalid_input",
  "filter_failure",
  "queue_overflow",
  "queue_eviction",
  "pressure_drop",
  "invoke_failure",
  "invalid_receipt",
  "collector_rejection",
  "acknowledgement_timeout",
] as const;
const SEVERITIES = ["trace", "debug", "info", "warn", "error"] as const;
const RENDERER_BATCH_ENVELOPE_BYTES = new TextEncoder().encode(JSON.stringify({
  schema_version: { major: 1, minor: 1 },
  records: [],
})).byteLength;

export type RendererLossReason = (typeof LOSS_REASONS)[number];

export interface RendererLossSnapshot {
  total: number;
  byReason: Readonly<Record<RendererLossReason, number>>;
  bySeverity: Readonly<Record<SeverityV1, number>>;
}

export interface RendererLossRecord {
  record: ProducerRecordV1;
  serializedBytes: number;
}

export interface RendererDiagnosticsBatcherDeps {
  invoke(batch: IngestBatchV1): Promise<IngestReceiptV1>;
  createLossRecord(snapshot: RendererLossSnapshot): RendererLossRecord | null;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  warn?(): void;
}

interface Acknowledgement {
  settled: boolean;
  expired: boolean;
  resolve(value: boolean): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface QueuedRecord extends RendererLossRecord {
  priority: boolean;
  acknowledgement?: Acknowledgement;
  lossSnapshot?: RendererLossSnapshot;
}

interface IdleWaiter {
  resolve(): void;
  promise: Promise<void>;
  timeout: ReturnType<typeof setTimeout>;
  deadlineAt: number;
}

export class RendererDiagnosticsBatcher {
  private readonly queue: QueuedRecord[] = [];
  private readonly lossesByReason = emptyReasonCounts();
  private readonly lossesBySeverity = emptySeverityCounts();
  private queuedBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private invokeInFlight: Promise<void> | null = null;
  private detachedInFlight: QueuedRecord[] | null = null;
  private detachedBytes = 0;
  private activeLossRecord: QueuedRecord | null = null;
  private pressure: PressureV1 = "normal";
  private pressureUntil = 0;
  private pressureProbeEntry: QueuedRecord | null = null;
  private idleWaiter: IdleWaiter | null = null;

  constructor(private readonly deps: RendererDiagnosticsBatcherDeps) {}

  emit(record: ProducerRecordV1, serializedBytes: number): void {
    this.admit(record, serializedBytes);
  }

  emitAcknowledged(
    record: ProducerRecordV1,
    serializedBytes: number,
    deadlineMs = RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let acknowledgement: Acknowledgement;
      const timeout = this.deps.setTimeout(() => {
        if (acknowledgement.settled) {
          return;
        }
        acknowledgement.settled = true;
        acknowledgement.expired = true;
        resolve(false);
        this.noteLoss("acknowledgement_timeout", record.severity);
      }, Math.max(0, Math.min(deadlineMs, RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS)));
      acknowledgement = {
        settled: false,
        expired: false,
        resolve,
        timeout,
      };
      if (!this.admit(record, serializedBytes, acknowledgement)) {
        this.settleAcknowledgement(acknowledgement, false);
      }
    });
  }

  noteLoss(reason: RendererLossReason, severity: SeverityV1): void {
    this.lossesByReason[reason] = incrementBounded(this.lossesByReason[reason]);
    this.lossesBySeverity[severity] = incrementBounded(
      this.lossesBySeverity[severity],
    );
  }

  async flush(deadlineMs = RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS): Promise<void> {
    if (this.queue.length === 0 && this.invokeInFlight === null) {
      return;
    }
    this.scheduleDrain(true);
    const boundedDeadline = Math.max(0, deadlineMs);
    const deadlineAt = this.deps.now() + boundedDeadline;
    if (this.idleWaiter !== null) {
      if (deadlineAt < this.idleWaiter.deadlineAt) {
        const waiter = this.idleWaiter;
        this.deps.clearTimeout(waiter.timeout);
        waiter.deadlineAt = deadlineAt;
        waiter.timeout = this.deps.setTimeout(
          () => this.resolveIdleWaiter(waiter),
          boundedDeadline,
        );
      }
      await this.idleWaiter.promise;
      return;
    }
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const waiter: IdleWaiter = {
      resolve: resolvePromise,
      promise,
      deadlineAt,
      timeout: this.deps.setTimeout(() => this.resolveIdleWaiter(waiter), boundedDeadline),
    };
    this.idleWaiter = waiter;
    await promise;
  }

  getPendingStateForTest(): {
    records: number;
    bytes: number;
    sequences: number[];
    invokeInFlight: boolean;
    pressure: PressureV1;
    lossTotal: number;
    idleWaiters: number;
    inFlightRecords: number;
    inFlightBytes: number;
    totalRecords: number;
    totalBytes: number;
  } {
    return {
      records: this.queue.length,
      bytes: this.queuedBytes,
      sequences: this.queue.map((entry) => entry.record.producer_sequence),
      invokeInFlight: this.invokeInFlight !== null,
      pressure: this.pressure,
      lossTotal: this.lossTotal(),
      idleWaiters: this.idleWaiter === null ? 0 : 1,
      inFlightRecords: this.detachedInFlight?.length ?? 0,
      inFlightBytes: this.detachedBytes,
      totalRecords: this.totalPendingRecords(),
      totalBytes: this.totalPendingBytes(),
    };
  }

  private admit(
    record: ProducerRecordV1,
    serializedBytes: number,
    acknowledgement?: Acknowledgement,
  ): boolean {
    const pressureAdmission = this.pressureAdmission(record.severity);
    if (pressureAdmission === "drop") {
      this.noteLoss("pressure_drop", record.severity);
      return false;
    }

    const priority = record.severity === "warn" || record.severity === "error";
    const entry: QueuedRecord = {
      record,
      serializedBytes,
      priority,
      acknowledgement,
    };
    if (!this.admitEntry(entry)) {
      this.noteLoss("queue_overflow", record.severity);
      return false;
    }
    if (pressureAdmission === "probe") {
      this.pressureProbeEntry = entry;
    }

    this.ensureLossRecord();
    const immediate = acknowledgement !== undefined
      || priority
      || this.queue.length >= RENDERER_BATCH_RECORD_LIMIT
      || this.queuedBytes >= RENDERER_BATCH_BYTE_LIMIT;
    this.scheduleDrain(immediate);
    return true;
  }

  private admitEntry(entry: QueuedRecord): boolean {
    if (
      entry.serializedBytes > RENDERER_QUEUE_BYTE_LIMIT
      || (!entry.priority && !this.ordinaryLaneCanAdmit(entry.serializedBytes))
    ) {
      return false;
    }

    if (entry.priority) {
      while (
        this.totalPendingRecords() >= RENDERER_QUEUE_RECORD_LIMIT
        || this.totalPendingBytes() + entry.serializedBytes > RENDERER_QUEUE_BYTE_LIMIT
      ) {
        if (this.queue.length === 0) {
          return false;
        }
        const evictionIndex = this.queue.findIndex((queued) => !queued.priority);
        this.dropQueuedAt(evictionIndex >= 0 ? evictionIndex : 0);
      }
    } else if (
      this.totalPendingRecords() >= RENDERER_QUEUE_RECORD_LIMIT
      || this.totalPendingBytes() + entry.serializedBytes > RENDERER_QUEUE_BYTE_LIMIT
    ) {
      return false;
    }

    this.queue.push(entry);
    this.queuedBytes += entry.serializedBytes;
    return true;
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

  private dropQueuedAt(index: number): void {
    const [dropped] = this.queue.splice(index, 1);
    if (!dropped) {
      return;
    }
    this.queuedBytes -= dropped.serializedBytes;
    this.noteLoss("queue_eviction", dropped.record.severity);
    this.settleAcknowledgement(dropped.acknowledgement, false);
    if (this.activeLossRecord === dropped) {
      this.activeLossRecord = null;
    }
    if (this.pressureProbeEntry === dropped) {
      this.pressureProbeEntry = null;
    }
  }

  private ensureLossRecord(): void {
    if (this.activeLossRecord !== null || this.lossTotal() === 0) {
      return;
    }
    const snapshot = this.lossSnapshot();
    let built: RendererLossRecord | null;
    try {
      built = this.deps.createLossRecord(snapshot);
    } catch {
      this.noteLoss("filter_failure", "warn");
      return;
    }
    if (built === null) {
      return;
    }
    const entry: QueuedRecord = {
      ...built,
      priority: true,
      lossSnapshot: snapshot,
    };
    if (this.admitEntry(entry)) {
      this.activeLossRecord = entry;
    }
  }

  private pressureAdmission(severity: SeverityV1): "allow" | "probe" | "drop" {
    if (severity === "warn" || severity === "error" || this.pressure === "normal") {
      return "allow";
    }
    const now = this.deps.now();
    if (now >= this.pressureUntil && this.pressureProbeEntry === null) {
      return "probe";
    }
    if (now >= this.pressureUntil) {
      return "drop";
    }
    return this.pressure === "critical" || severity === "trace" || severity === "debug"
      ? "drop"
      : "allow";
  }

  private scheduleDrain(immediate: boolean): void {
    if (this.invokeInFlight !== null && this.flushTimer === null) {
      return;
    }
    const delay = immediate ? 0 : RENDERER_FLUSH_INTERVAL_MS;
    if (this.flushTimer !== null) {
      if (!immediate) {
        return;
      }
      this.deps.clearTimeout(this.flushTimer);
    }
    this.flushTimer = this.deps.setTimeout(() => {
      this.flushTimer = null;
      this.startDrain();
    }, delay);
  }

  private startDrain(): void {
    if (this.invokeInFlight !== null || this.queue.length === 0) {
      this.resolveIdleWaitersIfIdle();
      return;
    }
    const detached = this.detachBatch();
    this.detachedInFlight = detached;
    this.detachedBytes = detached.reduce(
      (total, entry) => total + entry.serializedBytes,
      0,
    );
    const batch: IngestBatchV1 = {
      schema_version: { major: 1, minor: 1 },
      records: detached.map((entry) => entry.record),
    };
    const invocation = Promise.resolve()
      .then(() => this.deps.invoke(batch))
      .then((receipt) => {
        this.releaseDetached(detached);
        this.handleReceipt(detached, receipt);
      })
      .catch((error: unknown) => {
        this.releaseDetached(detached);
        this.handleInvokeFailure(
          detached,
          isRendererIngestProtocolError(error)
            ? "invalid_receipt"
            : "invoke_failure",
        );
      })
      .finally(() => {
        this.releaseDetached(detached);
        if (this.invokeInFlight === invocation) {
          this.invokeInFlight = null;
        }
        if (this.queue.length > 0) {
          this.scheduleDrain(true);
        } else {
          this.resolveIdleWaitersIfIdle();
        }
      });
    this.invokeInFlight = invocation;
  }

  private detachBatch(): QueuedRecord[] {
    const detached: QueuedRecord[] = [];
    let bytes = RENDERER_BATCH_ENVELOPE_BYTES;
    while (this.queue.length > 0 && detached.length < RENDERER_BATCH_RECORD_LIMIT) {
      const next = this.queue[0];
      const separatorBytes = detached.length === 0 ? 0 : 1;
      if (
        detached.length > 0
        && bytes + separatorBytes + next.serializedBytes > RENDERER_BATCH_BYTE_LIMIT
      ) {
        break;
      }
      this.queue.shift();
      this.queuedBytes -= next.serializedBytes;
      detached.push(next);
      bytes += separatorBytes + next.serializedBytes;
    }
    return detached;
  }

  private releaseDetached(detached: QueuedRecord[]): void {
    if (this.detachedInFlight !== detached) {
      return;
    }
    this.detachedInFlight = null;
    this.detachedBytes = 0;
  }

  private pendingEntries(): readonly QueuedRecord[] {
    return this.detachedInFlight === null
      ? this.queue
      : [...this.detachedInFlight, ...this.queue];
  }

  private totalPendingRecords(): number {
    return this.queue.length + (this.detachedInFlight?.length ?? 0);
  }

  private totalPendingBytes(): number {
    return this.queuedBytes + this.detachedBytes;
  }

  private handleReceipt(
    detached: QueuedRecord[],
    receipt: IngestReceiptV1,
  ): void {
    this.applyPressure(receipt.pressure, detached);
    const rejected = new Set(receipt.rejections.map((rejection) => rejection.index));
    for (let index = 0; index < detached.length; index += 1) {
      const entry = detached[index];
      if (rejected.has(index)) {
        this.noteLoss("collector_rejection", entry.record.severity);
        this.settleAcknowledgement(entry.acknowledgement, false);
        this.releaseFailedLossRecord(entry);
        this.releaseFailedPressureProbe(entry);
        continue;
      }
      this.settleAcknowledgement(entry.acknowledgement, true);
      if (entry.lossSnapshot !== undefined) {
        this.subtractLossSnapshot(entry.lossSnapshot);
        if (this.activeLossRecord === entry) {
          this.activeLossRecord = null;
        }
      }
    }
    this.ensureLossRecord();
  }

  private handleInvokeFailure(
    detached: QueuedRecord[],
    reason: "invoke_failure" | "invalid_receipt",
  ): void {
    for (const entry of detached) {
      this.noteLoss(reason, entry.record.severity);
      this.settleAcknowledgement(entry.acknowledgement, false);
      this.releaseFailedLossRecord(entry);
      this.releaseFailedPressureProbe(entry);
    }
    if (this.queue.length > 0) {
      this.ensureLossRecord();
    }
    try {
      this.deps.warn?.();
    } catch {
      // A development-only warning must never escape or recurse into diagnostics.
    }
  }

  private releaseFailedLossRecord(entry: QueuedRecord): void {
    if (this.activeLossRecord === entry) {
      this.activeLossRecord = null;
    }
  }

  private releaseFailedPressureProbe(entry: QueuedRecord): void {
    if (this.pressureProbeEntry === entry) {
      this.pressureProbeEntry = null;
    }
  }

  private applyPressure(pressure: PressureV1, detached: readonly QueuedRecord[]): void {
    this.pressure = pressure;
    if (
      pressure === "normal"
      || (this.pressureProbeEntry !== null && detached.includes(this.pressureProbeEntry))
    ) {
      this.pressureProbeEntry = null;
    }
    this.pressureUntil = pressure === "normal" ? 0 : this.deps.now() + 1_000;
  }

  private settleAcknowledgement(
    acknowledgement: Acknowledgement | undefined,
    value: boolean,
  ): void {
    if (acknowledgement === undefined || acknowledgement.settled) {
      return;
    }
    acknowledgement.settled = true;
    this.deps.clearTimeout(acknowledgement.timeout);
    acknowledgement.resolve(value);
  }

  private lossTotal(): number {
    return LOSS_REASONS.reduce(
      (total, reason) => Math.min(Number.MAX_SAFE_INTEGER, total + this.lossesByReason[reason]),
      0,
    );
  }

  private lossSnapshot(): RendererLossSnapshot {
    return {
      total: this.lossTotal(),
      byReason: { ...this.lossesByReason },
      bySeverity: { ...this.lossesBySeverity },
    };
  }

  private subtractLossSnapshot(snapshot: RendererLossSnapshot): void {
    for (const reason of LOSS_REASONS) {
      this.lossesByReason[reason] = Math.max(
        0,
        this.lossesByReason[reason] - snapshot.byReason[reason],
      );
    }
    for (const severity of SEVERITIES) {
      this.lossesBySeverity[severity] = Math.max(
        0,
        this.lossesBySeverity[severity] - snapshot.bySeverity[severity],
      );
    }
  }

  private resolveIdleWaitersIfIdle(): void {
    if (this.queue.length > 0 || this.invokeInFlight !== null) {
      return;
    }
    this.resolveIdleWaiter(this.idleWaiter);
  }

  private resolveIdleWaiter(waiter: IdleWaiter | null): void {
    if (waiter === null || this.idleWaiter !== waiter) {
      return;
    }
    this.idleWaiter = null;
    this.deps.clearTimeout(waiter.timeout);
    waiter.resolve();
  }
}

function emptyReasonCounts(): Record<RendererLossReason, number> {
  return Object.fromEntries(LOSS_REASONS.map((reason) => [reason, 0])) as Record<
    RendererLossReason,
    number
  >;
}

function emptySeverityCounts(): Record<SeverityV1, number> {
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    SeverityV1,
    number
  >;
}

function incrementBounded(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}
