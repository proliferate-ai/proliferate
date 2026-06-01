/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_EMAIL_ADDRESS } from "@/config/capabilities";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useSupportDialogState } from "@/hooks/support/facade/use-support-dialog-state";
import type { SupportMessageContext } from "@/lib/domain/support/types";

const showToast = vi.hoisted(() => vi.fn());
const openEmailCompose = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/hooks/support/workflows/use-session-debug-actions", () => ({
  useSessionDebugActions: () => ({
    canCopyInvestigationJson: false,
    canExportActiveSessionJson: false,
    canExportReplayRecording: false,
    canExportWorkspaceJson: false,
    handleCopyInvestigationJson: vi.fn(async () => {}),
    handleExportActiveSessionJson: vi.fn(async () => {}),
    handleExportReplayRecording: vi.fn(async () => {}),
    handleExportWorkspaceJson: vi.fn(async () => {}),
    isCopyingInvestigationJson: false,
    isExportingReplayRecording: false,
    isExportingSessionDebugJson: false,
    isExportingWorkspaceDebugJson: false,
  }),
}));

vi.mock("@/lib/access/tauri/diagnostics", () => ({
  collectSupportDiagnostics: vi.fn(async () => null),
  exportDebugBundle: vi.fn(async () => null),
  isTauriDesktop: () => false,
  logRendererDiagnostic: vi.fn(async () => undefined),
  logRendererEvent: vi.fn(async () => undefined),
  saveDiagnosticJson: vi.fn(async () => null),
}));

vi.mock("@/lib/access/tauri/shell", () => ({
  copyPath: vi.fn(async () => undefined),
  copyText: vi.fn(async () => {}),
  getHomeDir: vi.fn(async () => "/Users/pablo"),
  listAvailableEditors: vi.fn(async () => []),
  listOpenTargets: vi.fn(async () => []),
  openEmailCompose,
  openExternal: vi.fn(async () => undefined),
  openGmailCompose: vi.fn(async () => {}),
  openInEditor: vi.fn(async () => undefined),
  openInTerminal: vi.fn(async () => undefined),
  openOutlookCompose: vi.fn(async () => {}),
  openTarget: vi.fn(async () => undefined),
  pickFolder: vi.fn(async () => null),
  revealInFinder: vi.fn(async () => undefined),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

const context: SupportMessageContext = {
  source: "sidebar",
  intent: "general",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSupportDialogState", () => {
  it("opens email support instead of sending through the cloud support endpoint", async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSupportDialogState({ onClose, context }));

    await act(async () => {
      await result.current.handleEmail();
    });

    expect(openEmailCompose).toHaveBeenCalledWith({
      to: SUPPORT_EMAIL_ADDRESS,
      subject: CAPABILITY_COPY.supportEmailSubject,
      body: "",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
