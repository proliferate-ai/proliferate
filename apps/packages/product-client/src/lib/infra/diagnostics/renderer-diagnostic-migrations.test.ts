import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordHotWorkspaceReconcileFailure,
  recordSessionHistoryRehydrateFailure,
  recordSessionMetadataRefreshFailure,
} from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";
import {
  recordTranscriptPinTransition,
  recordTranscriptUserScrollIntent,
  recordTranscriptVirtualizerBlank,
} from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations-transcript";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

describe("fixed ProductClient renderer diagnostic migrations", () => {
  afterEach(() => resetRendererDiagnosticsSinkForTest());

  it("captures every fixed workflow failure name and owned correlation", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });

    recordTranscriptVirtualizerBlank({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      rowCount: 10,
      renderableRowCount: 10,
      virtualItemCount: 0,
      firstVirtualItemIndex: null,
      lastVirtualItemIndex: null,
    });
    recordHotWorkspaceReconcileFailure({
      operationId: "operation-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      errorName: "Error",
    });
    recordSessionMetadataRefreshFailure({
      sessionId: "session-1",
      operationId: "operation-1",
      errorName: "Error",
      errorMessage: "refresh failed",
    });
    recordSessionHistoryRehydrateFailure({
      sessionId: "session-1",
      operationId: "operation-1",
      errorName: "Error",
      timeoutAbort: false,
    });

    expect(emit.mock.calls.map(([input]) => input.name)).toEqual([
      "renderer.transcript.virtualizer_blank",
      "renderer.workspace.hot_reconcile_failed",
      "renderer.session.metadata_refresh_failed",
      "renderer.session.history_rehydrate_failed",
    ]);
    for (const [input] of emit.mock.calls) {
      expect(input).toEqual(expect.objectContaining({
        errorClassification: expect.any(String),
      }));
    }
  });

  it("preserves an explicitly invalid operation id for central rejection", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });

    recordSessionMetadataRefreshFailure({
      sessionId: "session-1",
      operationId: "",
      errorName: "Error",
      errorMessage: "refresh failed",
    });
    recordSessionHistoryRehydrateFailure({
      sessionId: "session-1",
      operationId: "",
      errorName: "Error",
      timeoutAbort: false,
    });

    expect(emit.mock.calls.map(([input]) => input.correlation)).toEqual([
      { sessionId: "session-1", operationId: "" },
      { sessionId: "session-1", operationId: "" },
    ]);
  });

  // Rung 11 (PRO-187, R10 / Q8): the two records that let a scripted scroll
  // bug reproduce from logs alone — see the engine call sites in
  // use-transcript-stick-to-bottom.ts.
  it("records a pin transition with its cause and a user-scroll-intent direction", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });

    recordTranscriptPinTransition({
      sessionId: "session-1",
      pinned: false,
      cause: "leave_band",
    });
    recordTranscriptUserScrollIntent({ sessionId: "session-1", direction: -1 });

    expect(emit.mock.calls.map(([input]) => input.name)).toEqual([
      "renderer.transcript.pin_transition",
      "renderer.transcript.user_scroll_intent",
    ]);
    expect(emit.mock.calls[0][0]).toEqual(expect.objectContaining({
      correlation: { sessionId: "session-1" },
      fields: expect.objectContaining({
        pinned: { privacy: "operational", value: false },
        cause: { privacy: "operational", value: "leave_band" },
      }),
    }));
    expect(emit.mock.calls[1][0]).toEqual(expect.objectContaining({
      correlation: { sessionId: "session-1" },
      fields: expect.objectContaining({
        direction: { privacy: "operational", value: -1 },
      }),
    }));
  });
});
