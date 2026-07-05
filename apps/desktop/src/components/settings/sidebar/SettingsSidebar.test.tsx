/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar } from "@/components/settings/sidebar/SettingsSidebar";
import {
  TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION,
  type SettingsSection,
} from "@/config/settings";
import { type SettingsScope } from "@/lib/domain/settings/navigation-presentation";
import {
  clearShortcutHandlerRegistryForTests,
  getShortcutHandler,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { useSupportModalStore } from "@/stores/support/support-modal-store";

vi.mock("@/components/app/sidebar/SidebarAccountFooter", () => ({
  SidebarAccountFooter: () => <div data-testid="sidebar-account-footer" />,
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

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    agents: [],
    agentsByKind: new Map(),
    isLoading: false,
    isReconciling: false,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearShortcutHandlerRegistryForTests();
});

function renderSettingsSidebar({
  activeScope = "user",
  activeSection = "general",
  adminAccess = { isAdmin: true, isLoading: false },
  disabledSections,
  onSelectSection = vi.fn(),
  onCheckForUpdates = vi.fn(),
  updateActionState,
}: {
  activeScope?: SettingsScope;
  activeSection?: SettingsSection;
  adminAccess?: { isAdmin: boolean; isLoading?: boolean };
  disabledSections?: Partial<Record<SettingsSection, boolean>>;
  onSelectSection?: (section: SettingsSection) => void;
  onCheckForUpdates?: () => void;
  updateActionState?: Partial<{
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
          activeScope={activeScope}
          activeSection={activeSection}
          adminAccess={adminAccess}
          disabledSections={disabledSections}
          onSelectSection={onSelectSection}
          onCheckForUpdates={onCheckForUpdates}
          updateActionState={{
            phase: "idle",
            updatesSupported: true,
            ...updateActionState,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsSidebar support modal", () => {
  it("opens the feedback modal from Support", async () => {
    renderSettingsSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Support" }));

    await waitFor(() => {
      expect(useSupportModalStore.getState().open).toBe(true);
      expect(useSupportModalStore.getState().kind).toBe("bug");
    });
  });
});

describe("SettingsSidebar layout and shortcuts", () => {
  it("renders the active scope's sections plus the global help footer in order", () => {
    renderSettingsSidebar({ activeScope: "user" });

    const navText = screen.getByRole("navigation", { name: "Settings" }).textContent ?? "";
    const expectedOrder = [
      "Account",
      "General",
      "Appearance",
      "Personal secrets",
      "Pruning",
      "Support",
      "Desktop updates",
    ];
    let previousIndex = -1;
    for (const label of expectedOrder) {
      const nextIndex = navText.indexOf(label, previousIndex + 1);
      expect(nextIndex).toBeGreaterThan(previousIndex);
      previousIndex = nextIndex;
    }

    // Sections from other scopes are not present in the User scope sidebar.
    expect(screen.queryByRole("button", { name: /Organization settings/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Defaults/ })).toBeNull();
  });

  it("renders the Org scope's admin sections for admins", () => {
    renderSettingsSidebar({ activeScope: "org", activeSection: "organization" });

    expect(screen.queryByRole("button", { name: /Organization settings/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Members/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Billing/ })).not.toBeNull();
    expect(screen.getByText("Policies")).toBeTruthy();
    expect(screen.getByText("Authentication")).toBeTruthy();
  });

  it("gives every harness its own entry in the Agents scope, in order", () => {
    renderSettingsSidebar({ activeScope: "agents", activeSection: "agent-claude" });

    const navText = screen.getByRole("navigation", { name: "Settings" }).textContent ?? "";
    const expectedOrder = [
      "Claude Code",
      "Codex",
      "OpenCode",
      "Grok",
      "API keys",
      "Defaults",
    ];
    let previousIndex = -1;
    for (const label of expectedOrder) {
      const nextIndex = navText.indexOf(label, previousIndex + 1);
      expect(nextIndex).toBeGreaterThan(previousIndex);
      previousIndex = nextIndex;
    }
  });

  it("hides Org admin sections from non-admins", () => {
    renderSettingsSidebar({
      activeScope: "org",
      activeSection: "organization",
      adminAccess: { isAdmin: false, isLoading: false },
    });

    if (TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION) {
      expect(screen.queryByRole("button", { name: /Organization settings/ })).not.toBeNull();
      return;
    }

    expect(screen.queryByRole("button", { name: /Organization settings/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Members/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Billing/ })).toBeNull();
    // The global help footer is still reachable.
    expect(screen.queryByRole("button", { name: "Support" })).not.toBeNull();
  });

  it("does not bold the active settings row", () => {
    renderSettingsSidebar({ activeScope: "user", activeSection: "general" });

    const activeRow = screen.getByRole("button", { name: /General/ });
    expect(activeRow.className).not.toContain("font-semibold");
  });

  it("keeps desktop update actions on the single settings row", () => {
    const onCheckForUpdates = vi.fn();
    renderSettingsSidebar({
      onCheckForUpdates,
      updateActionState: {
        phase: "ready",
      },
    });

    const desktopUpdates = screen.getByRole("button", { name: /Desktop updates/ });
    expect(desktopUpdates.textContent).toContain("Restart to update");
    expect(screen.queryByRole("button", { name: /Download update/ })).toBeNull();

    fireEvent.click(desktopUpdates);
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("shows Available only for the available phase and Restart to update for ready", () => {
    renderSettingsSidebar({ updateActionState: { phase: "available" } });
    let desktopUpdates = screen.getByRole("button", { name: /Desktop updates/ });
    expect(desktopUpdates.textContent).toContain("Available");
    expect(desktopUpdates.textContent).not.toContain("Restart to update");

    cleanup();

    renderSettingsSidebar({ updateActionState: { phase: "ready" } });
    desktopUpdates = screen.getByRole("button", { name: /Desktop updates/ });
    expect(desktopUpdates.textContent).toContain("Restart to update");
    expect(desktopUpdates.textContent).not.toContain("Available");
  });

  it("shows the checking and downloading statuses", () => {
    renderSettingsSidebar({ updateActionState: { phase: "checking" } });
    expect(
      screen.getByRole("button", { name: /Desktop updates/ }).textContent,
    ).toContain("Checking…");

    cleanup();

    renderSettingsSidebar({ updateActionState: { phase: "downloading" } });
    expect(
      screen.getByRole("button", { name: /Desktop updates/ }).textContent,
    ).toContain("Downloading");
  });

  it("disables the update row outside packaged builds with the packaged-only status", () => {
    const onCheckForUpdates = vi.fn();
    renderSettingsSidebar({
      onCheckForUpdates,
      updateActionState: { phase: "idle", updatesSupported: false },
    });

    const desktopUpdates = screen.getByRole("button", { name: /Desktop updates/ });
    expect(desktopUpdates.textContent).toContain("Packaged app only");
    expect(desktopUpdates.getAttribute("title")).toBe(
      "Updates only work in the packaged app.",
    );

    fireEvent.click(desktopUpdates);
    expect(onCheckForUpdates).not.toHaveBeenCalled();
  });

  it("uses the settings sidebar rail width", () => {
    const { container } = renderSettingsSidebar();

    expect(container.firstElementChild?.className).toContain("w-[240px]");
  });

  it("numbers the active scope's sections for Cmd shortcuts", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    const onSelectSection = vi.fn();
    renderSettingsSidebar({ activeScope: "user", onSelectSection });

    await waitFor(() => {
      expect(getShortcutHandler("settings.section-by-index")).not.toBeNull();
    });

    expect(screen.getByText("⌘1")).toBeTruthy();

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 1,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("account");

    expect(runShortcutHandler("settings.section-by-index", {
      source: "keyboard",
      digit: 2,
    })).toBe(true);
    expect(onSelectSection).toHaveBeenLastCalledWith("general");
  });

  it("keeps disabled sections in numbering but declines their shortcut", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    const onSelectSection = vi.fn();
    renderSettingsSidebar({
      activeScope: "user",
      disabledSections: { account: true },
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
    expect(onSelectSection).toHaveBeenLastCalledWith("general");
  });
});
