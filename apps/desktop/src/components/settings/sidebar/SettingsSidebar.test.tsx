/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import type { SettingsSection } from "@/config/settings";
import {
  clearShortcutHandlerRegistryForTests,
  getShortcutHandler,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { requestSupportDialog } from "@/lib/infra/support/support-dialog-request";

const openSupportReportWindow = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/access/tauri/support", () => ({
  openSupportReportWindow,
}));

vi.mock("@/components/app/sidebar/AppSidebarFooter", () => ({
  AppSidebarFooter: () => <div data-testid="app-sidebar-footer" />,
}));

vi.mock("@/hooks/support/derived/use-support-report-snapshot", () => ({
  useSupportReportSnapshot: () => ({
    openedAt: "2026-05-30T00:00:00.000Z",
    source: "settings",
    context: {
      source: "settings",
      intent: "general",
      pathname: "/settings?section=general",
    },
    defaultScope: "app_only",
    defaultWorkspaceId: null,
    workspaceOptions: [],
  }),
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
  onCheckForUpdates = vi.fn(),
  updateActionState,
}: {
  adminAccess?: { isAdmin: boolean; isLoading?: boolean };
  disabledSections?: Partial<Record<SettingsSection, boolean>>;
  onNavigateHome?: () => void;
  onSelectSection?: (section: SettingsSection) => void;
  onCheckForUpdates?: () => void;
  updateActionState?: Partial<{
    isChecking: boolean;
    hasAvailableUpdate: boolean;
    phase: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";
    updatesSupported: boolean;
  }>;
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
          onCheckForUpdates={onCheckForUpdates}
          updateActionState={{
            isChecking: false,
            hasAvailableUpdate: false,
            phase: "idle",
            updatesSupported: true,
            ...updateActionState,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsSidebar support window", () => {
  it("opens the support report window from Support", async () => {
    renderSettingsSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Support" }));

    await waitFor(() => {
      expect(openSupportReportWindow).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the support report window from the global support request", async () => {
    renderSettingsSidebar();

    act(() => {
      requestSupportDialog();
    });

    await waitFor(() => {
      expect(openSupportReportWindow).toHaveBeenCalledTimes(1);
    });
  });
});

describe("SettingsSidebar layout and shortcuts", () => {
  it("renders the settings IA from the mock in order", () => {
    renderSettingsSidebar();

    const navText = screen.getByRole("navigation", { name: "Settings" }).textContent ?? "";
    const expectedOrder = [
      "Settings",
      "General",
      "Appearance",
      "Keyboard shortcuts",
      "Account",
      "Admin",
      "Organization settings",
      "Members",
      "Plan + billing",
      "Integrations",
      "Model policy",
      "Limits",
      "Workspaces",
      "Environments",
      "Personal compute",
      "Pruning",
      "Archived chats",
      "Agents",
      "Authentication",
      "Defaults",
      "Help",
      "Support",
    ];
    let previousIndex = -1;
    for (const label of expectedOrder) {
      const nextIndex = navText.indexOf(label, previousIndex + 1);
      expect(nextIndex).toBeGreaterThan(previousIndex);
      previousIndex = nextIndex;
    }

    expect(screen.queryByText("Organization & Account")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cloud" })).toBeNull();
  });

  it("does not render admin tags for admin-only settings rows", () => {
    renderSettingsSidebar();

    const adminPills = screen.getAllByText("Admin").filter((element) => element.tagName === "SPAN");
    expect(adminPills).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Slack bot/ })).toBeNull();
  });

  it("marks visible settings rows outside the target IA as tbr", () => {
    renderSettingsSidebar();

    expect(screen.getAllByText("tbr")).toHaveLength(1);
  });

  it("hides admin-only rows for non-admins", () => {
    const onSelectSection = vi.fn();
    renderSettingsSidebar({
      adminAccess: { isAdmin: false, isLoading: false },
      onSelectSection,
    });

    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByRole("button", { name: /Members/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Organization settings/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Plan \+ billing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Integrations/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Model policy/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Limits/ })).toBeNull();
  });

  it("uses visible settings rows for non-admin shortcut numbering", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    const onSelectSection = vi.fn();
    renderSettingsSidebar({
      adminAccess: { isAdmin: false, isLoading: false },
      onSelectSection,
    });

    await waitFor(() => {
      expect(getShortcutHandler("settings.section-by-index")).not.toBeNull();
    });

    expect(screen.getByText("⌘1")).toBeTruthy();
    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 1,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("general");
  });

  it("keeps the back row full width", () => {
    renderSettingsSidebar();

    const backRow = screen.getByRole("button", { name: "Back to app" });
    expect(backRow.className).toContain("w-full");
    expect(backRow.className).not.toContain("w-fit");
  });

  it("does not bold the active settings row", () => {
    renderSettingsSidebar();

    const activeRow = screen.getByRole("button", { name: /General/ });
    expect(activeRow.className).not.toContain("font-semibold");
  });

  it("keeps desktop update actions on the single settings row", () => {
    const onCheckForUpdates = vi.fn();
    renderSettingsSidebar({
      onCheckForUpdates,
      updateActionState: {
        hasAvailableUpdate: true,
        phase: "ready",
      },
    });

    const desktopUpdates = screen.getByRole("button", { name: /Desktop updates/ });
    expect(desktopUpdates.textContent).toContain("Available");
    expect(screen.queryByRole("button", { name: /Restart to update/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Download update/ })).toBeNull();

    fireEvent.click(desktopUpdates);
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("uses the product sidebar rail width", () => {
    const { container } = renderSettingsSidebar();

    expect(container.firstElementChild?.className).toContain("w-[280px]");
  });

  it("renders Cmd number labels with the sidebar reveal treatment", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    renderSettingsSidebar();

    const shortcutLabel = screen.getByText("⌘6");
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
      digit: 6,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("organization-members");

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 9,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("agent-defaults");
  });

  it("keeps disabled sections in numbering but declines their shortcut", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    const onSelectSection = vi.fn();
    renderSettingsSidebar({
      disabledSections: { general: true },
      onSelectSection,
    });

    await waitFor(() => {
      expect(getShortcutHandler("settings.section-by-index")).not.toBeNull();
    });

    expect(screen.getByText("⌘1")).toBeTruthy();

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 1,
    })).toBe(false);
    expect(onSelectSection).not.toHaveBeenCalled();

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("appearance");
  });
});
