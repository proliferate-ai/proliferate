/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportDialog } from "@/components/support/SupportDialog";
import { SUPPORT_MESSAGE_MAX_LENGTH } from "@/lib/domain/support/constants";
import type { SupportMessageContext } from "@/lib/integrations/cloud/support";

const supportState = vi.hoisted(() => ({
  current: null as SupportDialogStateMock | null,
}));

vi.mock("@/hooks/support/use-support-dialog-state", () => ({
  useSupportDialogState: () => supportState.current,
}));

interface SupportDialogStateMock {
  canExportDebugBundle: boolean;
  canCopyInvestigationJson: boolean;
  canExportActiveSessionJson: boolean;
  canExportReplayRecording: boolean;
  canExportWorkspaceJson: boolean;
  contextLabel: string | null;
  fallbackEmail: string;
  handleCopyInvestigationJson: () => Promise<void>;
  handleExportActiveSessionJson: () => Promise<void>;
  handleExportReplayRecording: () => Promise<void>;
  handleExportDebugBundle: () => Promise<void>;
  handleExportWorkspaceJson: () => Promise<void>;
  handleCopyEmail: () => Promise<void>;
  handleEmail: () => Promise<void>;
  handleGmail: () => Promise<void>;
  handleOutlook: () => Promise<void>;
  handleSend: () => Promise<void>;
  inAppSupportEnabled: boolean;
  isCopyingInvestigationJson: boolean;
  isExportingDebugBundle: boolean;
  isExportingReplayRecording: boolean;
  isExportingSessionDebugJson: boolean;
  isExportingWorkspaceDebugJson: boolean;
  isSendingSupportMessage: boolean;
  message: string;
  setMessage: (message: string) => void;
}

const context: SupportMessageContext = {
  source: "sidebar",
  intent: "general",
  workspaceName: "hedgehog",
  workspaceLocation: "local",
};

function createSupportState(
  overrides: Partial<SupportDialogStateMock> = {},
): SupportDialogStateMock {
  return {
    canExportDebugBundle: true,
    canCopyInvestigationJson: true,
    canExportActiveSessionJson: true,
    canExportReplayRecording: true,
    canExportWorkspaceJson: true,
    contextLabel: "local · hedgehog",
    fallbackEmail: "support@example.com",
    handleCopyInvestigationJson: vi.fn(async () => {}),
    handleExportActiveSessionJson: vi.fn(async () => {}),
    handleExportReplayRecording: vi.fn(async () => {}),
    handleExportDebugBundle: vi.fn(async () => {}),
    handleExportWorkspaceJson: vi.fn(async () => {}),
    handleCopyEmail: vi.fn(async () => {}),
    handleEmail: vi.fn(async () => {}),
    handleGmail: vi.fn(async () => {}),
    handleOutlook: vi.fn(async () => {}),
    handleSend: vi.fn(async () => {}),
    inAppSupportEnabled: true,
    isCopyingInvestigationJson: false,
    isExportingDebugBundle: false,
    isExportingReplayRecording: false,
    isExportingSessionDebugJson: false,
    isExportingWorkspaceDebugJson: false,
    isSendingSupportMessage: false,
    message: "",
    setMessage: vi.fn(),
    ...overrides,
  };
}

function renderSupportDialog(overrides: Partial<SupportDialogStateMock> = {}) {
  supportState.current = createSupportState(overrides);

  return render(
    <SupportDialog
      onClose={vi.fn()}
      context={context}
    />,
  );
}

beforeEach(() => {
  supportState.current = createSupportState();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SupportDialog", () => {
  it("blocks telemetry on the portaled panel and shows the support message count", () => {
    renderSupportDialog({ message: "Need help" });

    const dialog = screen.getByRole("dialog", { name: "Support" });
    const textarea = screen.getByPlaceholderText("What do you need help with?") as HTMLTextAreaElement;

    expect(dialog.getAttribute("data-telemetry-block")).toBe("true");
    expect(textarea.maxLength).toBe(SUPPORT_MESSAGE_MAX_LENGTH);
    expect(screen.getByText(`${"Need help".length} / ${SUPPORT_MESSAGE_MAX_LENGTH}`)).toBeTruthy();
  });

  it("clamps pasted support messages before storing them", () => {
    const setMessage = vi.fn();
    renderSupportDialog({ setMessage });

    fireEvent.change(screen.getByPlaceholderText("What do you need help with?"), {
      target: { value: "a".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 1) },
    });

    expect(setMessage).toHaveBeenCalledWith("a".repeat(SUPPORT_MESSAGE_MAX_LENGTH));
  });

  it("keeps diagnostics collapsed until the disclosure opens", () => {
    renderSupportDialog();

    const disclosure = screen.getByRole("button", { name: /Session debugging/i });
    const region = document.getElementById(disclosure.getAttribute("aria-controls") ?? "");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(region?.hidden).toBe(true);
    expect(screen.queryByRole("button", { name: "Copy investigation JSON" })).toBeNull();

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(region?.hidden).toBe(false);
    expect(screen.getByText("Copy investigation JSON")).toBeTruthy();
    expect(screen.getByText(/Event exports include prompts/)).toBeTruthy();
  });

  it("keeps Gmail first without a white fallback background", () => {
    renderSupportDialog({ inAppSupportEnabled: false });

    const buttons = screen.getAllByRole("button");
    const gmail = screen.getByRole("button", { name: /Gmail/i });
    const outlook = screen.getByRole("button", { name: /Outlook/i });

    expect(buttons.indexOf(gmail)).toBeLessThan(buttons.indexOf(outlook));
    expect(gmail.className).toContain("bg-foreground/5");
    expect(gmail.className).not.toContain("bg-primary");
    expect(outlook.className).toContain("border");
  });
});
