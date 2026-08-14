import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordAutomationClaimPollFailure,
  recordHotWorkspaceReconcileFailure,
  recordSessionHistoryRehydrateFailure,
  recordSessionMetadataRefreshFailure,
  recordTranscriptVirtualizerBlank,
} from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

describe("fixed ProductClient renderer diagnostic migrations", () => {
  afterEach(() => resetRendererDiagnosticsSinkForTest());

  it("captures every fixed workflow failure name and owned correlation", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });

    recordAutomationClaimPollFailure("TypeError");
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
      "renderer.automation.claim_poll_failed",
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
});
