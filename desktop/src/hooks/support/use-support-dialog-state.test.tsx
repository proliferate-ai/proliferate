/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSupportDialogState } from "@/hooks/support/use-support-dialog-state";
import { SUPPORT_MESSAGE_MAX_LENGTH } from "@/lib/domain/support/constants";
import type { SupportMessageContext } from "@/lib/integrations/cloud/client";

const sendSupportMessage = vi.hoisted(() => vi.fn(async () => {}));
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/capabilities/use-app-capabilities", () => ({
  useAppCapabilities: () => ({ supportEnabled: true }),
}));

vi.mock("@/hooks/cloud/use-send-support-message", () => ({
  useSendSupportMessage: () => ({
    sendSupportMessage,
    isSendingSupportMessage: false,
  }),
}));

vi.mock("@/hooks/support/use-session-debug-actions", () => ({
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

vi.mock("@/platform/tauri/diagnostics", () => ({
  exportDebugBundle: vi.fn(async () => null),
  isTauriDesktop: () => false,
}));

vi.mock("@/platform/tauri/shell", () => ({
  copyText: vi.fn(async () => {}),
  openEmailCompose: vi.fn(async () => {}),
  openGmailCompose: vi.fn(async () => {}),
  openOutlookCompose: vi.fn(async () => {}),
}));

vi.mock("@/stores/auth/auth-store", () => ({
  useAuthStore: (selector: (state: { status: string }) => unknown) =>
    selector({ status: "authenticated" }),
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
  it("does not send support payloads beyond the server message limit", async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSupportDialogState({ onClose, context }));

    act(() => {
      result.current.setMessage(`  ${"a".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 5)}  `);
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(sendSupportMessage).toHaveBeenCalledWith({
      message: "a".repeat(SUPPORT_MESSAGE_MAX_LENGTH),
      context,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
