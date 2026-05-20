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
  onNavigateHome = vi.fn(),
  onSelectSection = vi.fn(),
}: {
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
      expect(getShortcutHandler("workspace.tab-by-index")).not.toBeNull();
    });

    expect(runShortcutHandler("workspace.tab-by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("appearance");

    expect(runShortcutHandler("workspace.tab-by-index", {
      source: "keyboard",
      digit: 9,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("review");
  });
});
