/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportMessageContext } from "@proliferate/cloud-sdk/client/support";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import type { SettingsSection } from "@/config/settings";
import {
  clearShortcutHandlerRegistryForTests,
  getShortcutHandler,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { requestSupportDialog } from "@/lib/infra/support/support-dialog-request";

const supportDialogRender = vi.hoisted(() => vi.fn());

vi.mock("@/components/support/SupportDialog", () => ({
  SupportDialog: (props: {
    onClose: () => void;
    context: SupportMessageContext;
  }) => {
    supportDialogRender(props);
    return (
      <div data-testid="support-dialog">
        <button type="button" onClick={props.onClose}>
          Close support
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearShortcutHandlerRegistryForTests();
});

function renderSettingsSidebar({
  adminAccess = { isAdmin: true, isLoading: false },
  disabledSections,
  onNavigateHome = vi.fn(),
  onSelectSection = vi.fn(),
}: {
  adminAccess?: { isAdmin: boolean; isLoading?: boolean };
  disabledSections?: Partial<Record<SettingsSection, boolean>>;
  onNavigateHome?: () => void;
  onSelectSection?: (section: SettingsSection) => void;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings?section=general"]}>
        <SettingsSidebar
          activeSection="general"
          adminAccess={adminAccess}
          disabledSections={disabledSections}
          onNavigateHome={onNavigateHome}
          onSelectSection={onSelectSection}
          onCheckForUpdates={vi.fn()}
          onDownloadUpdate={vi.fn()}
          onOpenRestartPrompt={vi.fn()}
          updateActionState={{
            availableVersion: null,
            downloadProgress: null,
            isChecking: false,
            hasAvailableUpdate: false,
            phase: "idle",
            updatesSupported: true,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsSidebar support mount boundary", () => {
  it("does not mount SupportDialog until Support is opened", async () => {
    renderSettingsSidebar();

    expect(supportDialogRender).not.toHaveBeenCalled();
    expect(screen.queryByTestId("support-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Support" }));

    expect(supportDialogRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("support-dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close support" }));

    await waitFor(() => {
      expect(screen.queryByTestId("support-dialog")).toBeNull();
    });
  });

  it("opens SupportDialog from the global support request", () => {
    renderSettingsSidebar();

    expect(screen.queryByTestId("support-dialog")).toBeNull();

    act(() => {
      requestSupportDialog();
    });

    expect(supportDialogRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("support-dialog")).toBeTruthy();
  });
});

describe("SettingsSidebar layout and shortcuts", () => {
  it("renders the settings IA from the mock in order", () => {
    renderSettingsSidebar();

    const navText = screen.getByRole("navigation", { name: "Settings" }).textContent ?? "";
    const expectedOrder = [
      "Preferences",
      "General",
      "Appearance",
      "Keyboard",
      "Organization & Account",
      "Account",
      "Organization",
      "Billing",
      "Workspace",
      "Environments",
      "Worktrees",
      "Shared Sandbox",
      "Compute",
      "Agents",
      "Agent Defaults",
      "Agent Authentication",
      "Review",
      "Slack bot",
      "Help",
      "Support",
    ];
    let previousIndex = -1;
    for (const label of expectedOrder) {
      const nextIndex = navText.indexOf(label, previousIndex + 1);
      expect(nextIndex).toBeGreaterThan(previousIndex);
      previousIndex = nextIndex;
    }

    expect(screen.queryByText("Workflows")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cloud" })).toBeNull();
  });

  it("renders admin tags for admin-only settings rows", () => {
    renderSettingsSidebar();

    expect(screen.getAllByText("Admin")).toHaveLength(2);
  });

  it("disables admin-only rows for non-admins", () => {
    const onSelectSection = vi.fn();
    renderSettingsSidebar({
      adminAccess: { isAdmin: false, isLoading: false },
      onSelectSection,
    });

    const sharedEnvironments = screen.getByRole("button", { name: /Shared Sandbox/ }) as HTMLButtonElement;
    expect(sharedEnvironments.disabled).toBe(true);
    expect(sharedEnvironments.getAttribute("title")).toBe("Admin access required");

    fireEvent.click(sharedEnvironments);
    expect(onSelectSection).not.toHaveBeenCalledWith("shared-environments");
  });

  it("keeps the back row full width", () => {
    renderSettingsSidebar();

    const backRow = screen.getByRole("button", { name: "Back to app" });
    expect(backRow.className).toContain("w-full");
    expect(backRow.className).not.toContain("w-fit");
  });

  it("renders Cmd number labels with the sidebar reveal treatment", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    renderSettingsSidebar();

    const shortcutLabel = screen.getByText("⌘1");
    expect(shortcutLabel.className).toContain("opacity-0");
    expect(shortcutLabel.className).toContain("group-hover:opacity-100");
  });

  it("selects settings sections from Cmd number shortcuts", async () => {
    const onSelectSection = vi.fn();
    renderSettingsSidebar({ onSelectSection });

    await waitFor(() => {
      expect(getShortcutHandler("settings.section-by-index")).not.toBeNull();
    });

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("appearance");

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 9,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("slack-bot");
  });

  it("keeps disabled sections in numbering but declines their shortcut", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    const onSelectSection = vi.fn();
    renderSettingsSidebar({
      disabledSections: { appearance: true },
      onSelectSection,
    });

    await waitFor(() => {
      expect(getShortcutHandler("settings.section-by-index")).not.toBeNull();
    });

    expect(screen.getByText("⌘2")).toBeTruthy();

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(false);
    expect(onSelectSection).not.toHaveBeenCalled();

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 3,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("keyboard");
  });
});
