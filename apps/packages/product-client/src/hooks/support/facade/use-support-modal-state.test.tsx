/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_REPORT_JOB_EVENT } from "#product/lib/access/browser/support-report-job-events";
import type { SupportReportJob } from "#product/lib/domain/support/report-types";
import { useSupportModalState } from "#product/hooks/support/facade/use-support-modal-state";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

const diagnosticsMocks = vi.hoisted(() => ({
  rendererDiagnostic: vi.fn(),
  deleteAttachment: vi.fn(async () => {}),
  stageAttachment: vi.fn(async () => null),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: { diagnostics: diagnosticsMocks } }),
}));

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
  useSessionSelectionStore: (selector: (state: { activeSessionId: string | null }) => unknown) =>
    selector({ activeSessionId: null }),
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

describe("useSupportModalState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
