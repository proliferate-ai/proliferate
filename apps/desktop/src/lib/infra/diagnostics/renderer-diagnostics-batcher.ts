import type {
  IngestBatchV1,
  IngestReceiptV1,
  PressureV1,
  ProducerRecordV1,
  SeverityV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import type {
  RendererLossReason,
  RendererLossRecord,
  RendererLossSnapshot,
} from "./renderer-diagnostics-batcher-limits";
import {
  RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS,
  RENDERER_BATCH_BYTE_LIMIT,
  RENDERER_BATCH_RECORD_LIMIT,
  RENDERER_FLUSH_INTERVAL_MS,
} from "./renderer-diagnostics-batcher-limits";
import type { Acknowledgement } from "./renderer-diagnostics-batcher-waiters";
import {
  createAcknowledgement,
  IdleGate,
  settleAcknowledgement,
} from "./renderer-diagnostics-batcher-waiters";
import { RendererLossLedger } from "./renderer-diagnostics-loss-ledger";
import { classifyRendererIngestError } from "./renderer-diagnostics-native-error";
import type { QueuedRecord } from "./renderer-diagnostics-queue";
import { RendererRecordQueue } from "./renderer-diagnostics-queue";

export type {
  RendererLossReason,
  RendererLossRecord,
  RendererLossSnapshot,
} from "./renderer-diagnostics-batcher-limits";
export {
  RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS,
  RENDERER_BATCH_BYTE_LIMIT,
  RENDERER_BATCH_RECORD_LIMIT,
  RENDERER_FLUSH_INTERVAL_MS,
  RENDERER_ORDINARY_BYTE_LIMIT,
  RENDERER_ORDINARY_RECORD_LIMIT,
  RENDERER_QUEUE_BYTE_LIMIT,
  RENDERER_QUEUE_RECORD_LIMIT,
} from "./renderer-diagnostics-batcher-limits";

export interface RendererDiagnosticsBatcherDeps {
  invoke(batch: IngestBatchV1): Promise<IngestReceiptV1>;
  createLossRecord(snapshot: RendererLossSnapshot): RendererLossRecord | null;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  warn?(): void;
}

export class RendererDiagnosticsBatcher {
  private readonly records = new RendererRecordQueue();
  private readonly losses = new RendererLossLedger();
  private readonly idleGate: IdleGate;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private invokeInFlight: Promise<void> | null = null;
  private activeLossRecord: QueuedRecord | null = null;
  private pressure: PressureV1 = "normal";
  private pressureUntil = 0;
  private pressureProbeEntry: QueuedRecord | null = null;

  constructor(private readonly deps: RendererDiagnosticsBatcherDeps) {
    this.idleGate = new IdleGate(deps);
  }

  emit(record: ProducerRecordV1, serializedBytes: number): void {
    this.admit(record, serializedBytes);
  }

  emitAcknowledged(
    record: ProducerRecordV1,
    serializedBytes: number,
    deadlineMs = RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const acknowledgement = createAcknowledgement(
        this.deps,
        deadlineMs,
        resolve,
        () => this.noteLoss("acknowledgement_timeout", record.severity),
      );
      if (!this.admit(record, serializedBytes, acknowledgement)) {
        this.settleAcknowledgement(acknowledgement, false);
      }
    });
  }

  noteLoss(reason: RendererLossReason, severity: SeverityV1): void {
    this.losses.note(reason, severity);
  }

  async flush(deadlineMs = RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS): Promise<void> {
    if (this.records.length === 0 && this.invokeInFlight === null) {
      return;
    }
    this.scheduleDrain(true);
    await this.idleGate.wait(deadlineMs);
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
      records: this.records.length,
      bytes: this.records.bytes,
      sequences: this.records.sequences(),
      invokeInFlight: this.invokeInFlight !== null,
      pressure: this.pressure,
      lossTotal: this.losses.total(),
      idleWaiters: this.idleGate.pendingCount(),
      inFlightRecords: this.records.inFlightRecords,
      inFlightBytes: this.records.inFlightBytes,
      totalRecords: this.records.totalRecords(),
      totalBytes: this.records.totalBytes(),
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
      || this.records.length >= RENDERER_BATCH_RECORD_LIMIT
      || this.records.bytes >= RENDERER_BATCH_BYTE_LIMIT;
    this.scheduleDrain(immediate);
    return true;
  }

  private admitEntry(entry: QueuedRecord): boolean {
    const admission = this.records.admit(entry);
    for (const dropped of admission.evicted) {
      this.noteLoss("queue_eviction", dropped.record.severity);
      this.settleAcknowledgement(dropped.acknowledgement, false);
      this.releaseFailedLossRecord(dropped);
      this.releaseFailedPressureProbe(dropped);
    }
    return admission.admitted;
  }

  private ensureLossRecord(): void {
    if (this.activeLossRecord !== null || this.losses.total() === 0) {
      return;
    }
    const snapshot = this.losses.snapshot();
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
    if (this.invokeInFlight !== null || this.records.length === 0) {
      this.resolveIdleWaitersIfIdle();
      return;
    }
    const detached = this.records.detachBatch();
    const batch: IngestBatchV1 = {
      schema_version: { major: 1, minor: 1 },
      records: detached.map((entry) => entry.record),
    };
    const invocation = Promise.resolve()
      .then(() => this.deps.invoke(batch))
      .then((receipt) => {
        this.records.releaseDetached(detached);
        this.handleReceipt(detached, receipt);
      })
      .catch((error: unknown) => {
        this.records.releaseDetached(detached);
        this.handleInvokeFailure(detached, classifyRendererIngestError(error));
      })
      .finally(() => {
        this.records.releaseDetached(detached);
        if (this.invokeInFlight === invocation) {
          this.invokeInFlight = null;
        }
        if (this.records.length > 0) {
          this.scheduleDrain(true);
        } else {
          this.resolveIdleWaitersIfIdle();
        }
      });
    this.invokeInFlight = invocation;
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
        this.losses.subtract(entry.lossSnapshot);
        if (this.activeLossRecord === entry) {
          this.activeLossRecord = null;
        }
      }
    }
    this.ensureLossRecord();
  }

  private handleInvokeFailure(
    detached: QueuedRecord[],
    reason: RendererLossReason,
  ): void {
    for (const entry of detached) {
      this.noteLoss(reason, entry.record.severity);
      this.settleAcknowledgement(entry.acknowledgement, false);
      this.releaseFailedLossRecord(entry);
      this.releaseFailedPressureProbe(entry);
    }
    if (this.records.length > 0) {
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
    settleAcknowledgement(this.deps, acknowledgement, value);
  }

  private resolveIdleWaitersIfIdle(): void {
    if (this.records.length > 0 || this.invokeInFlight !== null) {
      return;
    }
    this.idleGate.resolveNow();
  }
}
