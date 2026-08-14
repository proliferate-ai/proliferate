import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IngestBatchV1,
  IngestReceiptV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import { RendererDiagnosticsRuntime } from "./renderer-diagnostics";

const mocks = vi.hoisted(() => ({
  emitAcknowledged: vi.fn(),
}));

vi.mock("./renderer-diagnostics", async (importOriginal) => ({
  ...await importOriginal<typeof import("./renderer-diagnostics")>(),
  emitRendererDiagnosticAcknowledged: mocks.emitAcknowledged,
}));

type Listener = (event: any) => void;

async function loadErrorDiagnostics() {
  vi.resetModules();
  return import("./renderer-error-diagnostics");
}

describe("renderer error diagnostics", () => {
  let listeners: Map<string, Listener>;

  beforeEach(() => {
    listeners = new Map();
    vi.stubEnv("DEV", true);
    mocks.emitAcknowledged.mockReset();
    mocks.emitAcknowledged.mockResolvedValue(true);
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, listener: Listener) => {
        listeners.set(type, listener);
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers listeners once and emits the stable window-error record", async () => {
    const diagnostics = await loadErrorDiagnostics();
    diagnostics.initializeDesktopRendererErrorDiagnostics();
    diagnostics.initializeDesktopRendererErrorDiagnostics();

    expect(window.addEventListener).toHaveBeenCalledTimes(2);
    listeners.get("error")?.({ error: new Error("renderer blew up"), message: "renderer blew up" });
    await Promise.resolve();

    expect(mocks.emitAcknowledged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "renderer.error.window",
        errorClassification: "window_error",
        message: "renderer blew up",
      }),
      500,
    );
  });

  it("preserves the stackless development network suppression", async () => {
    const diagnostics = await loadErrorDiagnostics();
    diagnostics.initializeDesktopRendererErrorDiagnostics();
    const error = new TypeError("Load failed");
    Object.defineProperty(error, "stack", { value: undefined });
    listeners.get("unhandledrejection")?.({ reason: error });
    await Promise.resolve();

    expect(mocks.emitAcknowledged).not.toHaveBeenCalled();
  });

  it("emits an unsuppressed rejection with its exact stable classification", async () => {
    const diagnostics = await loadErrorDiagnostics();
    diagnostics.initializeDesktopRendererErrorDiagnostics();
    listeners.get("unhandledrejection")?.({ reason: new Error("rejected work") });
    await Promise.resolve();

    expect(mocks.emitAcknowledged).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "renderer.error.unhandled_rejection",
        errorClassification: "unhandled_rejection",
        message: "rejected work",
      }),
      500,
    );
  });

  it("shares in-flight proof and caches only successful proof for three seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
    let resolveEmission: ((value: boolean) => void) | undefined;
    mocks.emitAcknowledged.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { resolveEmission = resolve; }),
    );
    const diagnostics = await loadErrorDiagnostics();
    const error = new Error("same render failure");

    const first = diagnostics.reportReactRenderError(error, "at App");
    const duplicate = diagnostics.reportReactRenderError(error, "at App");
    resolveEmission?.(true);
    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(true);
    await expect(diagnostics.reportReactRenderError(error, "at App")).resolves.toBe(true);
    expect(mocks.emitAcknowledged).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_000);
    await expect(diagnostics.reportReactRenderError(error, "at App")).resolves.toBe(true);
    expect(mocks.emitAcknowledged).toHaveBeenCalledTimes(2);
  });

  it("does not dedupe distinct errors whose old delimiter fingerprint collided", async () => {
    const diagnostics = await loadErrorDiagnostics();
    const first = new Error("alpha\n::\nbeta");
    Object.defineProperty(first, "stack", { value: "gamma" });
    const second = new Error("alpha");
    Object.defineProperty(second, "stack", { value: "beta" });

    await expect(
      diagnostics.reportReactRenderError(first, "delta"),
    ).resolves.toBe(true);
    await expect(
      diagnostics.reportReactRenderError(second, "gamma\n::\ndelta"),
    ).resolves.toBe(true);

    expect(mocks.emitAcknowledged).toHaveBeenCalledTimes(2);
  });

  it("never caches failure or a late false acknowledgement", async () => {
    const diagnostics = await loadErrorDiagnostics();
    const error = new Error("not admitted");
    mocks.emitAcknowledged.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(diagnostics.reportReactRenderError(error, "at App")).resolves.toBe(false);
    await expect(diagnostics.reportReactRenderError(error, "at App")).resolves.toBe(true);
    expect(mocks.emitAcknowledged).toHaveBeenCalledTimes(2);
  });

  it("contains synchronous reporter failure", async () => {
    const diagnostics = await loadErrorDiagnostics();
    mocks.emitAcknowledged.mockImplementationOnce(() => {
      throw new Error("logger failed");
    });

    await expect(
      diagnostics.reportReactRenderError(new Error("render failed"), "at App"),
    ).resolves.toBe(false);
  });

  it("never executes error getters or arbitrary string coercion", async () => {
    const diagnostics = await loadErrorDiagnostics();
    let getterCalls = 0;
    let toStringCalls = 0;
    const hostile = {
      toString() {
        toStringCalls += 1;
        throw new Error("must not stringify");
      },
    };
    Object.defineProperties(hostile, {
      message: {
        get() {
          getterCalls += 1;
          throw new Error("must not read message");
        },
      },
      stack: {
        get() {
          getterCalls += 1;
          throw new Error("must not read stack");
        },
      },
    });

    await expect(diagnostics.reportReactRenderError(hostile)).resolves.toBe(true);
    expect(getterCalls).toBe(0);
    expect(toStringCalls).toBe(0);
    expect(mocks.emitAcknowledged).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "renderer.error.react_render",
        errorClassification: "react_render_error",
        message: "[non-error rejection]",
      }),
      500,
    );
  });

  it("bounds huge error work and redacts credentials crossing every error cutoff", async () => {
    vi.useFakeTimers();
    const batches: IngestBatchV1[] = [];
    const runtime = new RendererDiagnosticsRuntime({
      invoke: vi.fn(async (batch: IngestBatchV1): Promise<IngestReceiptV1> => {
        batches.push(batch);
        return {
          schema_version: { major: 1, minor: 1 },
          collector_boot_id: "collector-boot",
          accepted_range: { first: 1, last: batch.records.length },
          accepted_count: batch.records.length,
          duplicate_count: 0,
          rejections: [],
          pressure: "normal",
        };
      }),
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => undefined,
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
    mocks.emitAcknowledged.mockImplementation(async (input) => {
      runtime.emit(input);
      await vi.runAllTimersAsync();
      return true;
    });
    const diagnostics = await loadErrorDiagnostics();
    const messageCanary = "message-userinfo-canary";
    const stackCanary = "stack-userinfo-canary";
    const tokenBoundaryPrefix = "ghp_AB12CD";
    const error = new Error(
      `${"m".repeat(16_384 - 40)} https://user:${messageCanary}${"p".repeat(600)}@host.invalid${"z".repeat(2_000_000)}`,
    );
    Object.defineProperty(error, "stack", {
      value: `${"s".repeat(4_096 - 40)} https://user:${stackCanary}${"p".repeat(600)}@host.invalid${"z".repeat(2_000_000)}`,
    });
    const componentStack = `${"c".repeat(4_096 + 512 - tokenBoundaryPrefix.length)}${tokenBoundaryPrefix}${"z".repeat(2_000_000)}`;

    await expect(
      diagnostics.reportReactRenderError(error, componentStack),
    ).resolves.toBe(true);
    const hugeStacklessTypeError = new TypeError("n".repeat(2_000_000));
    Object.defineProperty(hugeStacklessTypeError, "stack", { value: undefined });
    await expect(
      diagnostics.reportReactRenderError(hugeStacklessTypeError),
    ).resolves.toBe(true);

    const serialized = JSON.stringify(batches.flatMap((batch) => batch.records));
    expect(serialized).not.toContain(messageCanary);
    expect(serialized).not.toContain(stackCanary);
    expect(serialized).not.toContain(tokenBoundaryPrefix);
    expect(serialized).toContain("[REDACTED]");
    expect(batches[0].records[0].redaction).toBe("structural");
    expect(batches.flatMap((batch) => batch.records)).toHaveLength(2);
  });
});
