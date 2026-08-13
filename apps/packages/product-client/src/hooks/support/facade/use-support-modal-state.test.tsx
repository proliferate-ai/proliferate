/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_REPORT_JOB_EVENT } from "#product/lib/access/browser/support-report-job-events";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";
import { useSupportModalState } from "#product/hooks/support/facade/use-support-modal-state";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

const snapshotBridge = vi.hoisted(() => ({
  beginPreparation: vi.fn(),
  finishPreparation: vi.fn(),
  cancelPreparation: vi.fn(async () => {}),
  saveArchive: vi.fn(async () => "diagnostics.zip"),
  readArtifact: vi.fn(),
  deleteArtifact: vi.fn(async () => {}),
  reconcileArtifacts: vi.fn(),
  beginSubmission: vi.fn(),
  finishSubmission: vi.fn(),
}));

const diagnosticsMocks = vi.hoisted(() => ({
  rendererDiagnostic: vi.fn(),
  deleteAttachment: vi.fn(async () => {}),
  stageAttachment: vi.fn(async () => null),
  // Null by default: the ordinary lane is a host without the native support
  // coordinator, where the consent surface never appears.
  supportSnapshot: null as unknown,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: {
      runtime: { getConnection: vi.fn(), restart: vi.fn() },
      diagnostics: diagnosticsMocks,
    },
  }),
}));

const access = vi.hoisted(() => ({
  resolveSupportSnapshotAccess: vi.fn(),
  collectResolvedSupportSessionEvidence: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/support-snapshot-connection", () => access);

vi.mock("#product/hooks/support/derived/use-support-report-snapshot", () => ({
  useSupportReportSnapshot: () => ({
    openedAt: "2026-07-05T00:00:00.000Z",
    source: "sidebar",
    context: { source: "sidebar", intent: "general" },
    defaultScope: "app_only",
    defaultWorkspaceId: null,
    workspaceOptions: [],
  }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: {
      activeSessionId: string | null;
      selectedWorkspaceId: string | null;
    }) => unknown,
  ) => selector({ activeSessionId: null, selectedWorkspaceId: null }),
}));

function captureDispatchedJob(): { current: SupportReportJob | null } {
  const captured: { current: SupportReportJob | null } = { current: null };
  window.addEventListener(SUPPORT_REPORT_JOB_EVENT, ((event: CustomEvent<{
    job: SupportReportJob;
  }>) => {
    captured.current = event.detail.job;
  }) as EventListener);
  return captured;
}

const PREPARED_ARTIFACT = {
  artifactSchemaVersion: 3,
  artifactId: "artifact-1",
  snapshotId: "snapshot-1",
  preparationOperationId: "op-1",
  generatedAt: "2026-08-13T00:00:01.000Z",
  sizeBytes: 2048,
  sha256: "a".repeat(64),
  summary: {
    collectorRecords: 1,
    fallbackRecords: 0,
    sessions: 0,
    omissions: 1,
    truncations: 0,
  },
};

/** Put the hook on a host that can actually prepare a snapshot. */
function enableSupportSnapshotHost() {
  diagnosticsMocks.supportSnapshot = snapshotBridge;
  snapshotBridge.beginPreparation.mockResolvedValue({
    preparationId: "prep-1",
    preparationOperationId: "op-1",
    capturedAt: "2026-08-13T00:00:00.000Z",
    window: {
      sourceTimeFrom: "2026-08-12T23:45:00.000Z",
      sourceTimeTo: "2026-08-13T00:00:00.000Z",
    },
  });
  snapshotBridge.finishPreparation.mockResolvedValue(PREPARED_ARTIFACT);
  access.resolveSupportSnapshotAccess.mockResolvedValue({
    state: "none",
    binding: { kind: "none", reason: "no_selected_bundled_local_workspace" },
  });
  access.collectResolvedSupportSessionEvidence.mockResolvedValue({
    state: "omitted",
    sessionEvidenceJson: null,
    sessionCollection: {
      state: "omitted",
      reason: "no_selected_bundled_local_workspace",
    },
  });
}

describe("useSupportModalState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diagnosticsMocks.supportSnapshot = null;
    setRendererDiagnosticsSink({ emit: diagnosticsMocks.rendererDiagnostic });
  });

  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
    vi.clearAllMocks();
  });

  it("records the typed local report-opened marker", () => {
    renderHook(() => useSupportModalState({ kind: "bug", onClose: vi.fn() }));

    expect(diagnosticsMocks.rendererDiagnostic).toHaveBeenCalledWith({
      name: "renderer.support.report_opened",
      severity: "info",
      kind: "milestone",
      privacy: "operational",
      fields: {
        kind: { value: "bug", privacy: "operational" },
        job_id: { value: expect.any(String), privacy: "operational" },
      },
    });
  });

  it("carries bug fields with an explicit no-snapshot intent", async () => {
    const captured = captureDispatchedJob();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "bug", onClose: vi.fn() })
    );

    act(() => {
      rendered.result.current.setMessage("It broke");
      rendered.result.current.setUrgent(true);
      rendered.result.current.setNotifyMe(true);
      rendered.result.current.setCreditConsent(true);
    });
    act(() => {
      rendered.result.current.setCreditName("Ada Lovelace");
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(captured.current).not.toBeNull();
    expect(captured.current).toMatchObject({
      kind: "bug",
      urgent: true,
      notifyMe: true,
      supportSnapshot: { kind: "none" },
      creditConsent: true,
      creditName: "Ada Lovelace",
    });
  });

  it("defaults the bug job to no snapshot, not urgent, and no notify", async () => {
    const captured = captureDispatchedJob();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "bug", onClose: vi.fn() })
    );

    act(() => {
      rendered.result.current.setMessage("It broke");
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(captured.current).toMatchObject({
      urgent: false,
      notifyMe: false,
      supportSnapshot: { kind: "none" },
      creditConsent: false,
      creditName: null,
    });
  });

  it("authors no includeLogs key and exposes no log-attachment control", async () => {
    const captured = captureDispatchedJob();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "bug", onClose: vi.fn() })
    );

    // The hook must not offer the flag at all. A surviving setter is what let a
    // pre-ticked "Include app logs" box render over a job that never carried
    // the field, so the box silently did nothing.
    expect(rendered.result.current).not.toHaveProperty("includeLogs");
    expect(rendered.result.current).not.toHaveProperty("setIncludeLogs");

    act(() => {
      rendered.result.current.setMessage("It broke");
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    // Log attachment is now owned by prepared-snapshot consent, so a freshly
    // authored job carries the explicit no-snapshot intent and no legacy flag.
    expect(captured.current).not.toBeNull();
    expect(Object.hasOwn(captured.current!, "includeLogs")).toBe(false);
    expect(captured.current).toMatchObject({ supportSnapshot: { kind: "none" } });
  });

  it("keeps prompt jobs non-urgent and no-snapshot while carrying notifyMe", async () => {
    const captured = captureDispatchedJob();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "feature", onClose: vi.fn() })
    );

    act(() => {
      rendered.result.current.setMessage("Build me a thing");
      rendered.result.current.setUrgent(true); // Should be ignored for prompts.
      rendered.result.current.setNotifyMe(true);
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(captured.current).toMatchObject({
      kind: "feature",
      urgent: false,
      notifyMe: true,
      supportSnapshot: { kind: "none" },
    });
  });

  it("stages nothing on open and sends no snapshot while consent is unchecked", async () => {
    enableSupportSnapshotHost();
    const captured = captureDispatchedJob();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "bug", onClose: vi.fn() })
    );

    // Opening the modal reads no customer detail and stages nothing natively.
    expect(rendered.result.current.snapshotConsent.available).toBe(true);
    expect(rendered.result.current.snapshotConsent.consent).toBe(false);
    expect(snapshotBridge.beginPreparation).not.toHaveBeenCalled();
    expect(access.resolveSupportSnapshotAccess).not.toHaveBeenCalled();

    act(() => {
      rendered.result.current.setMessage("It broke");
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(snapshotBridge.beginPreparation).not.toHaveBeenCalled();
    expect(snapshotBridge.finishPreparation).not.toHaveBeenCalled();
    expect(captured.current).toMatchObject({ supportSnapshot: { kind: "none" } });
  });

  it("carries the exact prepared artifact once consent is checked at send", async () => {
    enableSupportSnapshotHost();
    const captured = captureDispatchedJob();
    const onClose = vi.fn();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "bug", onClose })
    );

    act(() => {
      rendered.result.current.setMessage("It broke");
      rendered.result.current.snapshotConsent.setConsent(true);
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(snapshotBridge.beginPreparation).toHaveBeenCalledTimes(1);
    expect(snapshotBridge.finishPreparation).toHaveBeenCalledTimes(1);
    expect(captured.current).toMatchObject({
      supportSnapshot: {
        kind: "prepared",
        consent: {
          version: 1,
          disclosureVersion: "desktop_support_snapshot_customer_content_v1",
          selection: { kind: "recent_activity" },
        },
        artifact: { artifactId: "artifact-1", sha256: "a".repeat(64) },
      },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the modal open and enqueues nothing when preparation fails fatally", async () => {
    enableSupportSnapshotHost();
    snapshotBridge.finishPreparation.mockRejectedValueOnce(new Error("scrub_failed"));
    const captured = captureDispatchedJob();
    const onClose = vi.fn();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "bug", onClose })
    );

    act(() => {
      rendered.result.current.setMessage("It broke");
      rendered.result.current.snapshotConsent.setConsent(true);
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(captured.current).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(rendered.result.current.snapshotConsent.error).not.toBeNull();
    // The draft survives, so the user can retry or clear the box and send.
    expect(rendered.result.current.message).toBe("It broke");
    expect(rendered.result.current.canSend).toBe(true);

    act(() => {
      rendered.result.current.snapshotConsent.setConsent(false);
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(captured.current).toMatchObject({ supportSnapshot: { kind: "none" } });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("supersedes an in-flight preparation when the modal is cancelled", async () => {
    enableSupportSnapshotHost();
    let releaseEvidence: (() => void) | null = null;
    access.collectResolvedSupportSessionEvidence.mockImplementation(() =>
      new Promise((resolve) => {
        releaseEvidence = () => resolve({ state: "cancelled" });
      })
    );
    const captured = captureDispatchedJob();
    const onClose = vi.fn();
    const rendered = renderHook(() =>
      useSupportModalState({ kind: "bug", onClose })
    );

    act(() => {
      rendered.result.current.setMessage("It broke");
      rendered.result.current.snapshotConsent.setConsent(true);
    });
    let sending: Promise<void> | null = null;
    await act(async () => {
      sending = rendered.result.current.handleSend();
      await waitFor(() => expect(snapshotBridge.beginPreparation).toHaveBeenCalled());
    });

    await act(async () => {
      rendered.result.current.handleCancel();
      releaseEvidence?.();
      await sending;
    });

    expect(snapshotBridge.finishPreparation).not.toHaveBeenCalled();
    expect(snapshotBridge.cancelPreparation).toHaveBeenCalledWith({
      clientJobId: expect.any(String),
      consentEpoch: expect.any(String),
      preparationId: "prep-1",
    });
    // Cancelling closes the modal without enqueueing a report.
    expect(captured.current).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
