import {
  diagnosticField,
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticCorrelation,
  type RendererDiagnosticInput,
  type RendererDiagnosticsSink,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import type { SeverityV1 } from "@proliferate/product-client/internal/domain/diagnostics/contract";

import {
  ingestRendererDiagnosticsBatch,
  isTauriDesktop,
} from "@/lib/access/tauri/diagnostics";
import { getDesktopTelemetryConfig } from "@/lib/integrations/telemetry/config";
import {
  RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS,
  RendererDiagnosticsBatcher,
  type RendererDiagnosticsBatcherDeps,
  type RendererLossSnapshot,
} from "./renderer-diagnostics-batcher";
import {
  buildRendererProducerRecord,
  prevalidateRendererDiagnostic,
  type PrevalidatedRendererDiagnostic,
} from "./renderer-diagnostic-filter";

export interface RendererDiagnosticContext extends RendererDiagnosticCorrelation {
  operationId: string;
}

interface RendererDiagnosticsRuntimeDeps {
  invoke: RendererDiagnosticsBatcherDeps["invoke"];
  now(): number;
  randomId(): string;
  pathname(): string | undefined;
  release: string;
  environment: string;
  setTimeout: RendererDiagnosticsBatcherDeps["setTimeout"];
  clearTimeout: RendererDiagnosticsBatcherDeps["clearTimeout"];
  warn?(): void;
}

export class RendererDiagnosticsRuntime implements RendererDiagnosticsSink {
  readonly producerBootId: string;
  private nextSequence = 1;
  private readonly batcher: RendererDiagnosticsBatcher;

  constructor(private readonly deps: RendererDiagnosticsRuntimeDeps) {
    this.producerBootId = deps.randomId();
    this.batcher = new RendererDiagnosticsBatcher({
      invoke: deps.invoke,
      createLossRecord: (snapshot) => this.createLossRecord(snapshot),
      now: deps.now,
      setTimeout: deps.setTimeout,
      clearTimeout: deps.clearTimeout,
      warn: deps.warn,
    });
  }

  emit(input: RendererDiagnosticInput): void {
    try {
      const built = this.build(input, true);
      if (built !== null) {
        this.batcher.emit(built.record, built.serializedBytes);
      }
    } catch {
      this.batcher.noteLoss("filter_failure", safeSeverity(input));
    }
  }

  async emitAcknowledged(
    input: RendererDiagnosticInput,
    deadlineMs = RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS,
  ): Promise<boolean> {
    try {
      const built = this.build(input, true);
      if (built === null) {
        return false;
      }
      return await this.batcher.emitAcknowledged(
        built.record,
        built.serializedBytes,
        deadlineMs,
      );
    } catch {
      this.batcher.noteLoss("filter_failure", safeSeverity(input));
      return false;
    }
  }

  flush(deadlineMs?: number): Promise<void> {
    return this.batcher.flush(deadlineMs);
  }

  getStateForTest(): ReturnType<RendererDiagnosticsBatcher["getPendingStateForTest"]> & {
    nextSequence: number;
  } {
    return {
      ...this.batcher.getPendingStateForTest(),
      nextSequence: this.nextSequence,
    };
  }

  private build(input: RendererDiagnosticInput, includePathname: boolean) {
    const prevalidated = prevalidateRendererDiagnostic(input);
    if (prevalidated === null) {
      this.batcher.noteLoss("invalid_input", safeSeverity(input));
      return null;
    }
    return this.buildPrevalidated(prevalidated, includePathname);
  }

  private buildPrevalidated(
    input: PrevalidatedRendererDiagnostic,
    includePathname: boolean,
  ) {
    const producerSequence = this.nextSequence;
    this.nextSequence += 1;
    const operationId = input.correlation.operationId ?? this.deps.randomId();
    const built = buildRendererProducerRecord(input, {
      producerBootId: this.producerBootId,
      producerSequence,
      release: this.deps.release,
      environment: this.deps.environment,
      operationId,
      sourceTimestamp: new Date(this.deps.now()).toISOString(),
      pathname: includePathname ? this.deps.pathname() : undefined,
    });
    if (built === null) {
      this.batcher.noteLoss("filter_failure", input.severity);
    }
    return built;
  }

  private createLossRecord(snapshot: RendererLossSnapshot) {
    return this.buildPrevalidated({
      name: "renderer.diagnostics.loss",
      severity: "warn",
      kind: "loss_summary",
      privacy: "operational",
      correlation: {},
      droppedCount: snapshot.total,
      structural: false,
      fields: {
        by_reason: diagnosticField(snapshot.byReason, "operational"),
        by_severity: diagnosticField(snapshot.bySeverity, "operational"),
      },
    }, false);
  }
}

let installedRuntime: RendererDiagnosticsRuntime | null = null;
let lifecycleFlushInstalled = false;

export function installRendererDiagnostics(): boolean {
  if (!isTauriDesktop()) {
    return false;
  }
  if (installedRuntime !== null) {
    return true;
  }
  const config = getDesktopTelemetryConfig();
  let lastWarningAt = Number.NEGATIVE_INFINITY;
  installedRuntime = new RendererDiagnosticsRuntime({
    invoke: ingestRendererDiagnosticsBatch,
    now: () => Date.now(),
    randomId: createUuid,
    pathname: currentPathname,
    release: config.release,
    environment: config.environment,
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
    warn: () => {
      const now = Date.now();
      if (import.meta.env.DEV && now - lastWarningAt >= 30_000) {
        lastWarningAt = now;
        console.warn("Renderer diagnostics delivery is unavailable");
      }
    },
  });
  setRendererDiagnosticsSink(installedRuntime);
  installLifecycleFlush();
  return true;
}

export function emitRendererDiagnosticAcknowledged(
  input: RendererDiagnosticInput,
  deadlineMs = RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS,
): Promise<boolean> {
  return installedRuntime?.emitAcknowledged(input, deadlineMs)
    ?? Promise.resolve(false);
}

export function flushRendererDiagnostics(deadlineMs?: number): Promise<void> {
  return installedRuntime?.flush(deadlineMs) ?? Promise.resolve();
}

export function createRendererDiagnosticContext(
  seed: RendererDiagnosticCorrelation = {},
): RendererDiagnosticContext {
  const correlation = safeCorrelation(seed);
  return {
    ...correlation,
    operationId: correlation.operationId ?? createUuid(),
  };
}

export function createChildRendererDiagnosticContext(
  parent: RendererDiagnosticContext,
  seed: Omit<
    RendererDiagnosticCorrelation,
    "operationId" | "parentOperationId"
  > = {},
): RendererDiagnosticContext {
  const inherited = safeCorrelation(parent);
  const replacement = safeCorrelation(seed);
  const parentOperationId = inherited.operationId ?? createUuid();
  return {
    traceId: replacement.traceId ?? inherited.traceId ?? parentOperationId,
    workspaceId: replacement.workspaceId ?? inherited.workspaceId,
    sessionId: replacement.sessionId ?? inherited.sessionId,
    turnId: replacement.turnId ?? inherited.turnId,
    itemId: replacement.itemId ?? inherited.itemId,
    requestId: replacement.requestId ?? inherited.requestId,
    targetId: replacement.targetId ?? inherited.targetId,
    promptId: replacement.promptId ?? inherited.promptId,
    workflowId: replacement.workflowId ?? inherited.workflowId,
    operationId: createUuid(),
    parentOperationId,
  };
}

export function resetRendererDiagnosticsForTest(): void {
  installedRuntime = null;
  lifecycleFlushInstalled = false;
  resetRendererDiagnosticsSinkForTest();
}

function installLifecycleFlush(): void {
  if (lifecycleFlushInstalled) {
    return;
  }
  lifecycleFlushInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushRendererDiagnostics(100);
    }
  });
  window.addEventListener("pagehide", () => {
    void flushRendererDiagnostics(100);
  });
}

function createUuid(): string {
  return globalThis.crypto.randomUUID();
}

function currentPathname(): string | undefined {
  try {
    return window.location.pathname || undefined;
  } catch {
    return undefined;
  }
}

function validId(value: string | undefined): value is string {
  return typeof value === "string"
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= 128;
}

const CORRELATION_KEYS = [
  "operationId",
  "parentOperationId",
  "traceId",
  "workspaceId",
  "sessionId",
  "turnId",
  "itemId",
  "requestId",
  "targetId",
  "promptId",
  "workflowId",
] as const satisfies readonly (keyof RendererDiagnosticCorrelation)[];

function safeCorrelation(value: unknown): RendererDiagnosticCorrelation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const correlation: RendererDiagnosticCorrelation = {};
    for (const key of CORRELATION_KEYS) {
      const descriptor = descriptors[key];
      if (
        descriptor?.enumerable === true
        && "value" in descriptor
        && validId(typeof descriptor.value === "string" ? descriptor.value : undefined)
      ) {
        correlation[key] = descriptor.value;
      }
    }
    return correlation;
  } catch {
    return {};
  }
}

function safeSeverity(input: unknown): SeverityV1 {
  try {
    if (typeof input !== "object" || input === null) {
      return "error";
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, "severity");
    const severity = descriptor?.enumerable === true && "value" in descriptor
      ? descriptor.value
      : undefined;
    return severity === "trace"
      || severity === "debug"
      || severity === "info"
      || severity === "warn"
      || severity === "error"
      ? severity
      : "error";
  } catch {
    return "error";
  }
}
