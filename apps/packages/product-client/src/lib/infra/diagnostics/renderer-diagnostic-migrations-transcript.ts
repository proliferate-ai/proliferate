import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

// Transcript-only diagnostic records, split out of renderer-diagnostic-migrations.ts
// (PRO-187, login runtime-budget fix). These are only imported by the
// chat/transcript UI hooks, which mount inside the AuthenticatedProductClient
// lazy chunk, never from the always-mounted login path. Keeping them in a
// separate module lets the bundler split them out of the /login bundle
// instead of dragging them along with recordTurnEnded and friends, which
// use-turn-end-diagnostics.ts pulls in from renderer-diagnostic-migrations.ts
// unconditionally via ProductLifecycleRoot.

export function recordTranscriptVirtualizerBlank(input: {
  sessionId: string;
  workspaceId: string | null;
  rowCount: number;
  renderableRowCount: number;
  virtualItemCount: number;
  firstVirtualItemIndex: number | null;
  lastVirtualItemIndex: number | null;
}): void {
  recordRendererDiagnostic({
    name: "renderer.transcript.virtualizer_blank",
    severity: "error",
    kind: "message",
    privacy: "operational",
    correlation: {
      sessionId: input.sessionId,
      ...(input.workspaceId === null ? {} : { workspaceId: input.workspaceId }),
    },
    fields: {
      row_count: diagnosticField(input.rowCount, "operational"),
      renderable_row_count: diagnosticField(input.renderableRowCount, "operational"),
      virtual_item_count: diagnosticField(input.virtualItemCount, "operational"),
      first_virtual_item_index: diagnosticField(
        input.firstVirtualItemIndex ?? -1,
        "operational",
      ),
      last_virtual_item_index: diagnosticField(
        input.lastVirtualItemIndex ?? -1,
        "operational",
      ),
    },
    errorClassification: "virtualizer_blank",
  });
}

// Rung 11 (PRO-187, requirement R10 / design question Q8): Cell 10's jank note
// was that pin-state transitions and classification outcomes were sampled for
// perf only, never persisted as debuggable events, so a production scroll bug
// could only be reproduced by hand. These two records are the fix: together
// they let a scripted bug reproduce from logs alone (rung 11's gate) —
// `renderer.transcript.user_scroll_intent` is the input-intent signal, and
// `renderer.transcript.pin_transition` is the resulting (or missing) pin-state
// change, each carrying the cause the engine already attributes internally.
// Observation-only: recording a transition never influences it, and both
// records reuse the SAME choke points (`setPinned`, `notifyUserScrollIntent`)
// the engine already uses for its own bookkeeping, so there is no new scroll
// writer and negligible overhead beyond the existing call.
export type TranscriptPinTransitionCause =
  | "user_intent_unpin"
  | "leave_band"
  | "repin_band"
  | "submit_repin"
  | "button_click"
  | "session_reset"
  | "restore_stranded"
  | "unspecified";

export function recordTranscriptPinTransition(input: {
  sessionId: string;
  pinned: boolean;
  cause: TranscriptPinTransitionCause;
}): void {
  recordRendererDiagnostic({
    name: "renderer.transcript.pin_transition",
    severity: "debug",
    kind: "message",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      pinned: diagnosticField(input.pinned, "operational"),
      cause: diagnosticField(input.cause, "operational"),
    },
  });
}

export function recordTranscriptUserScrollIntent(input: {
  sessionId: string;
  direction: -1 | 1;
}): void {
  recordRendererDiagnostic({
    name: "renderer.transcript.user_scroll_intent",
    severity: "debug",
    kind: "message",
    privacy: "operational",
    correlation: { sessionId: input.sessionId },
    fields: {
      direction: diagnosticField(input.direction, "operational"),
    },
  });
}
