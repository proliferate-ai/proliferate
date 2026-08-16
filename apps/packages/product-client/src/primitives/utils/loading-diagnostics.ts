/**
 * Loading-treatment diagnostics seam, owned by the primitives layer.
 *
 * `LoadingBoundary` sits below `lib`, so it cannot reach the renderer
 * diagnostics port directly (that would be an upward primitives -> lib edge the
 * boundary checker bans). Instead it emits its `renderer.loading.*` marks
 * through this inverted seam: the primitive owns the interface and a
 * module-level sink, and the lib renderer-diagnostics port registers a
 * forwarder into it — a legal downward `lib -> primitives` edge. Until that
 * registration runs the sink is a no-op, so the primitive never depends on lib
 * and stays safe to render in isolation (tests, playground).
 *
 * The emitted mark names/fields are the R1 family contract
 * (`renderer.loading.treatment_shown` / `treatment_suppressed` / `settled`);
 * the port forwarder maps this event into the identical
 * `RendererDiagnosticInput` shape.
 */

export interface LoadingDiagnosticsCorrelation {
  operationId?: string;
  parentOperationId?: string;
  traceId?: string;
  workspaceId?: string;
  sessionId?: string;
  turnId?: string;
  itemId?: string;
  requestId?: string;
  targetId?: string;
  promptId?: string;
  workflowId?: string;
}

export interface LoadingDiagnosticEvent {
  /** The `renderer.loading.*` mark name. */
  name: string;
  /** Flow label; the call site defaults an absent flow to `"unnamed"`. */
  flow: string;
  /** Correlation identifiers, forwarded verbatim to the renderer port. */
  correlation?: LoadingDiagnosticsCorrelation;
  /** Resolution outcome (`empty`/`ready`) for suppressed/settled marks. */
  resolution?: string;
  showDelayMs?: number;
  minDisplayMs?: number;
  heldMs?: number;
  elapsedMs?: number;
}

export interface LoadingDiagnosticsSink {
  record(event: LoadingDiagnosticEvent): void;
}

const noopLoadingDiagnosticsSink: LoadingDiagnosticsSink = {
  record: () => undefined,
};

let sink: LoadingDiagnosticsSink = noopLoadingDiagnosticsSink;

export function setLoadingDiagnosticsSink(next: LoadingDiagnosticsSink): void {
  sink = next;
}

export function resetLoadingDiagnosticsSinkForTest(): void {
  sink = noopLoadingDiagnosticsSink;
}

export function recordLoadingDiagnostic(event: LoadingDiagnosticEvent): void {
  try {
    sink.record(event);
  } catch {
    // Diagnostics must never change the caller's product behavior.
  }
}
