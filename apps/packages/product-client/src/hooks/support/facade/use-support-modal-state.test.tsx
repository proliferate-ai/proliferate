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
  window.addEventListener(SUPPORT_REPORT_JOB_EVENT, ((event: CustomEvent<SupportReportJob>) => {
    captured.current = event.detail;
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

  it("carries urgent, notifyMe, includeLogs, and credit fields on the bug job", async () => {
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
      rendered.result.current.setIncludeLogs(false);
    });
    await act(async () => {
      await rendered.result.current.handleSend();
    });

    expect(captured.current).not.toBeNull();
    expect(captured.current).toMatchObject({
      kind: "bug",
      urgent: true,
      notifyMe: true,
      includeLogs: false,
      creditConsent: true,
      creditName: "Ada Lovelace",
    });
  });

  it("defaults the bug job to logs-on, not urgent, no notify", async () => {
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
      includeLogs: true,
      creditConsent: false,
      creditName: null,
    });
  });

  it("keeps prompt jobs non-urgent with logs included while carrying notifyMe", async () => {
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
      includeLogs: true,
    });
  });
});
