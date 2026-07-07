/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_REPORT_JOB_EVENT } from "@/lib/access/tauri/support";
import type { SupportReportJob } from "@/lib/domain/support/report-types";
import { useSupportModalState } from "@/hooks/support/facade/use-support-modal-state";

vi.mock("@/lib/access/tauri/support", () => ({
  SUPPORT_REPORT_JOB_EVENT: "support-report-job",
  deleteStagedSupportReportAttachment: vi.fn(async () => {}),
  stageSupportReportAttachment: vi.fn(async () => null),
}));

vi.mock("@/lib/access/tauri/diagnostics", () => ({
  logRendererEvent: vi.fn(async () => {}),
}));

vi.mock("@/hooks/support/derived/use-support-report-snapshot", () => ({
  useSupportReportSnapshot: () => ({
    openedAt: "2026-07-05T00:00:00.000Z",
    source: "sidebar",
    context: { source: "sidebar", intent: "general" },
    defaultScope: "app_only",
    defaultWorkspaceId: null,
    workspaceOptions: [],
  }),
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
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
  });

  afterEach(() => {
    vi.clearAllMocks();
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
