/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportDialog } from "@/components/support/SupportDialog";
import type { SupportMessageContext } from "@/lib/domain/support/types";

const supportState = vi.hoisted(() => ({
  current: null as SupportDialogStateMock | null,
}));

vi.mock("@/hooks/support/facade/use-support-dialog-state", () => ({
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
  isCopyingInvestigationJson: boolean;
  isExportingDebugBundle: boolean;
  isExportingReplayRecording: boolean;
  isExportingSessionDebugJson: boolean;
  isExportingWorkspaceDebugJson: boolean;
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
    isCopyingInvestigationJson: false,
    isExportingDebugBundle: false,
    isExportingReplayRecording: false,
    isExportingSessionDebugJson: false,
    isExportingWorkspaceDebugJson: false,
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
  it("blocks telemetry on the portaled panel and shows email support options", () => {
    renderSupportDialog();

    const dialog = screen.getByRole("dialog", { name: "Support" });

    expect(dialog.getAttribute("data-telemetry-block")).toBe("true");
    expect(screen.queryByPlaceholderText("What do you need help with?")).toBeNull();
    const gmail = screen.getByRole("button", { name: /Gmail/i });
    expect(gmail).toBeTruthy();
    expect(document.activeElement).toBe(gmail);
    expect(screen.getByRole("button", { name: /Outlook/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mail app/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy email/i })).toBeTruthy();
    expect(screen.getByText("local · hedgehog")).toBeTruthy();
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
    renderSupportDialog();

    const buttons = screen.getAllByRole("button");
    const gmail = screen.getByRole("button", { name: /Gmail/i });
    const outlook = screen.getByRole("button", { name: /Outlook/i });

    expect(buttons.indexOf(gmail)).toBeLessThan(buttons.indexOf(outlook));
    expect(gmail.className).toContain("bg-foreground/5");
    expect(gmail.className).not.toContain("bg-primary");
    expect(outlook.className).toContain("border");
  });
});
