import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  diagnosticField,
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import { recordSessionMetadataRefreshFailure } from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostic-migrations";
import { parseProducerRecordV1 } from "@proliferate/product-client/internal/domain/diagnostics/validation";
import type {
  IngestBatchV1,
  IngestReceiptV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import {
  RendererDiagnosticsRuntime,
  createChildRendererDiagnosticContext,
  createRendererDiagnosticContext,
} from "./renderer-diagnostics";

function receipt(batch: IngestBatchV1): IngestReceiptV1 {
  return {
    schema_version: { major: 1, minor: 1 },
    collector_boot_id: "collector-boot",
    accepted_range: { first: 1, last: batch.records.length },
    accepted_count: batch.records.length,
    duplicate_count: 0,
    rejections: [],
    pressure: "normal",
  };
}

describe("renderer diagnostics runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
  });

  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
    vi.useRealTimers();
  });

  it("creates exact v1.1 detailed envelopes with one boot id and ascending sequences", async () => {
    const batches: IngestBatchV1[] = [];
    const ids = ["boot-id", "default-operation-1", "default-operation-2"];
    const runtime = new RendererDiagnosticsRuntime({
      invoke: vi.fn(async (batch: IngestBatchV1) => {
        batches.push(batch);
        return receipt(batch);
      }),
      now: () => Date.now(),
      randomId: () => ids.shift() ?? "extra-id",
      pathname: () => "/workspace/private-repository/session-42",
      release: "proliferate-desktop@0.4.8+abcdef123456",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });

    runtime.emit({
      name: "renderer.test.first",
      severity: "info",
      kind: "milestone",
      privacy: "operational",
      fields: { elapsed_ms: diagnosticField(12, "operational") },
    });
    runtime.emit({
      name: "renderer.test.second",
      severity: "warn",
      kind: "transport",
      privacy: "customer_content",
      correlation: {
        operationId: "operation-owned",
        parentOperationId: "operation-parent",
        traceId: "trace-owned",
        sessionId: "session-owned",
      },
    });
    await vi.runAllTimersAsync();

    const records = batches.flatMap((batch) => batch.records);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.producer_sequence)).toEqual([1, 2]);
    expect(records.map((record) => record.producer_boot_id)).toEqual([
      "boot-id",
      "boot-id",
    ]);
    expect(records[0]).toMatchObject({
      schema_version: { major: 1, minor: 1 },
      source_timestamp: "2026-08-11T12:00:00.000Z",
      component: "desktop_renderer",
      source: "renderer",
      release: "proliferate-desktop@0.4.8+abcdef123456",
      environment: "test",
      operation_id: "default-operation-1",
      record_class: "detailed",
      detailed: { kind: "milestone" },
    });
    expect(records[1]).toMatchObject({
      operation_id: "operation-owned",
      parent_operation_id: "operation-parent",
      trace_id: "trace-owned",
      session_id: "session-owned",
      detailed: { kind: "transport" },
    });
    for (const record of records) {
      expect(parseProducerRecordV1(record)).toEqual(record);
      expect(record.lifecycle).toBeUndefined();
      expect(record.arguments).toContainEqual(expect.objectContaining({
        name: "pathname",
        privacy: "sensitive",
      }));
    }
  });

  it("does not consume a sequence for invalid caller input", async () => {
    const invoke = vi.fn(async (batch: IngestBatchV1) => receipt(batch));
    const runtime = new RendererDiagnosticsRuntime({
      invoke,
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => undefined,
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });

    runtime.emit({
      name: "Renderer Invalid",
      severity: "info",
      privacy: "operational",
    });
    expect(runtime.getStateForTest()).toMatchObject({
      nextSequence: 1,
      lossTotal: 1,
    });

    runtime.emit({
      name: "renderer.test.valid_after_invalid",
      severity: "warn",
      privacy: "operational",
    });
    await vi.runAllTimersAsync();
    expect(invoke.mock.calls[0][0].records[0].producer_sequence).toBe(1);
  });

  it("rejects an invalid operation id preserved by a migrated producer", async () => {
    const invoke = vi.fn(async (batch: IngestBatchV1) => receipt(batch));
    const runtime = new RendererDiagnosticsRuntime({
      invoke,
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => undefined,
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
    setRendererDiagnosticsSink(runtime);

    recordSessionMetadataRefreshFailure({
      sessionId: "session-1",
      operationId: "",
      errorName: "Error",
      errorMessage: "refresh failed",
    });

    await vi.runAllTimersAsync();
    expect(invoke).not.toHaveBeenCalled();
    expect(runtime.getStateForTest()).toMatchObject({
      nextSequence: 1,
      lossTotal: 1,
    });
  });

  it("accepts explicitly undefined optional kind and correlation as absent", async () => {
    const invoke = vi.fn(async (batch: IngestBatchV1) => receipt(batch));
    const runtime = new RendererDiagnosticsRuntime({
      invoke,
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => undefined,
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });

    runtime.emit({
      name: "renderer.test.optional_undefined",
      severity: "warn",
      privacy: "operational",
      kind: undefined,
      correlation: undefined,
    });
    await vi.runAllTimersAsync();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0].records[0]).toMatchObject({
      name: "renderer.test.optional_undefined",
      detailed: { kind: "log" },
      producer_sequence: 1,
    });
  });

  it("keeps internal loss summaries operational and omits ambient pathname", async () => {
    const batches: IngestBatchV1[] = [];
    const runtime = new RendererDiagnosticsRuntime({
      invoke: vi.fn(async (batch: IngestBatchV1) => {
        batches.push(batch);
        return receipt(batch);
      }),
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => "/workspace/private-repository/session-42",
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });

    runtime.emit({ name: "invalid name", severity: "info", privacy: "operational" });
    runtime.emit({
      name: "renderer.test.after_loss",
      severity: "warn",
      privacy: "operational",
    });
    await vi.runAllTimersAsync();

    const loss = batches.flatMap((batch) => batch.records)
      .find((entry) => entry.name === "renderer.diagnostics.loss");
    expect(loss).toBeDefined();
    expect(loss?.privacy).toBe("operational");
    expect(loss?.arguments.map((argument) => argument.name)).not.toContain("pathname");
    expect(JSON.stringify(loss)).not.toContain("private-repository");
  });

  it("contains hostile proxy input for ordinary and acknowledged callers", async () => {
    const invoke = vi.fn(async (batch: IngestBatchV1) => receipt(batch));
    const runtime = new RendererDiagnosticsRuntime({
      invoke,
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => undefined,
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      },
      ownKeys() {
        throw new Error("own keys trap");
      },
    });

    expect(() => runtime.emit(hostile as never)).not.toThrow();
    await expect(runtime.emitAcknowledged(hostile as never)).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(runtime.getStateForTest()).toMatchObject({
      nextSequence: 1,
      lossTotal: 2,
    });
  });

  it("builds root and child contexts without executing correlation accessors", () => {
    let getterCalls = 0;
    const rootSeed = {
      operationId: "root-operation",
      workspaceId: "root-workspace",
      extra: "must-not-copy",
    } as Record<string, unknown>;
    Object.defineProperty(rootSeed, "traceId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("root getter executed");
      },
    });
    const root = createRendererDiagnosticContext(rootSeed as never);
    expect(root).toEqual({
      operationId: "root-operation",
      workspaceId: "root-workspace",
    });

    const parent = {
      operationId: "parent-operation",
      traceId: "parent-trace",
      sessionId: "parent-session",
    } as Record<string, unknown>;
    Object.defineProperty(parent, "workspaceId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("parent getter executed");
      },
    });
    const childSeed = { sessionId: "child-session" } as Record<string, unknown>;
    Object.defineProperty(childSeed, "traceId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("child getter executed");
      },
    });
    const child = createChildRendererDiagnosticContext(
      parent as never,
      childSeed as never,
    );

    expect(getterCalls).toBe(0);
    expect(child).toMatchObject({
      parentOperationId: "parent-operation",
      traceId: "parent-trace",
      sessionId: "child-session",
    });
    expect(child.operationId).not.toBe("parent-operation");
    expect(child.workspaceId).toBeUndefined();
  });
});
