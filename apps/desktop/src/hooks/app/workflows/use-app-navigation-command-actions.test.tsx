// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportMenuAction } from "@/lib/domain/support/support-menu-action";
import { useAppNavigationCommandActions } from "@/hooks/app/workflows/use-app-navigation-command-actions";

// This mirrors the sidebar's support-kind gating (`SidebarHelpSection`):
// vendor keeps the auth-gated feedback modal, operator routes straight to the
// operator's configured destination, and none hides the action entirely. The
// command-palette/Cmd+S "Open Support" action must follow the same rules.
const hookMocks = vi.hoisted(() => ({
  supportMenuAction: { kind: "vendor" } as SupportMenuAction,
  openBug: vi.fn(),
  supportDisabledReason: null as string | null,
  openExternal: vi.fn(() => Promise.resolve()),
  goToTopLevelRoute: vi.fn(),
  webApp: { available: true, baseUrl: "https://web.proliferate.com" } as {
    available: boolean;
    baseUrl: string | null;
  },
}));

vi.mock("@/hooks/support/derived/use-support-menu-action", () => ({
  useSupportMenuAction: () => hookMocks.supportMenuAction,
}));

vi.mock("@/hooks/support/workflows/use-open-support-report-window", () => ({
  useOpenSupportReportWindow: () => ({
    openBug: hookMocks.openBug,
    openFeature: vi.fn(),
    canSubmit: true,
    disabledReason: hookMocks.supportDisabledReason,
  }),
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({
    openExternal: hookMocks.openExternal,
  }),
}));

vi.mock("@/hooks/capabilities/derived/use-web-app-target", () => ({
  useWebAppTarget: () => hookMocks.webApp,
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    goToTopLevelRoute: hookMocks.goToTopLevelRoute,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>;
}

describe("useAppNavigationCommandActions support routing", () => {
  beforeEach(() => {
    hookMocks.supportMenuAction = { kind: "vendor" };
    hookMocks.openBug.mockClear();
    hookMocks.supportDisabledReason = null;
    hookMocks.openExternal.mockClear();
    hookMocks.goToTopLevelRoute.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("vendor: routes through the existing feedback report window, visible", () => {
    hookMocks.supportMenuAction = { kind: "vendor" };
    hookMocks.supportDisabledReason = "Sign in to Proliferate Cloud to send feedback.";
    const { result } = renderHook(() => useAppNavigationCommandActions(), { wrapper });

    expect(result.current.openSupport.hidden).toBeFalsy();
    expect(result.current.openSupport.disabledReason).toBe(
      "Sign in to Proliferate Cloud to send feedback.",
    );

    act(() => {
      result.current.openSupport.execute("palette");
    });

    expect(hookMocks.openBug).toHaveBeenCalledTimes(1);
    expect(hookMocks.openExternal).not.toHaveBeenCalled();
  });

  it("operator: opens the resolved destination directly, not gated by vendor auth", () => {
    hookMocks.supportMenuAction = {
      kind: "operator",
      url: "https://acme.example.com/support",
    };
    // Vendor auth would otherwise disable it; operator must ignore that.
    hookMocks.supportDisabledReason = "Sign in to Proliferate Cloud to send feedback.";
    const { result } = renderHook(() => useAppNavigationCommandActions(), { wrapper });

    expect(result.current.openSupport.hidden).toBeFalsy();
    expect(result.current.openSupport.disabledReason).toBeNull();

    act(() => {
      result.current.openSupport.execute("palette");
    });

    expect(hookMocks.openExternal).toHaveBeenCalledWith("https://acme.example.com/support");
    expect(hookMocks.openBug).not.toHaveBeenCalled();
  });

  it("operator with only an email: opens a mailto: link", () => {
    hookMocks.supportMenuAction = {
      kind: "operator",
      url: "mailto:it-help@acme.example.com",
    };
    const { result } = renderHook(() => useAppNavigationCommandActions(), { wrapper });

    act(() => {
      result.current.openSupport.execute("shortcut");
    });

    expect(hookMocks.openExternal).toHaveBeenCalledWith("mailto:it-help@acme.example.com");
  });

  it("none: hides the action and no-ops instead of opening anything", () => {
    hookMocks.supportMenuAction = { kind: "none" };
    const { result } = renderHook(() => useAppNavigationCommandActions(), { wrapper });

    expect(result.current.openSupport.hidden).toBe(true);

    act(() => {
      result.current.openSupport.execute("palette");
    });

    expect(hookMocks.openBug).not.toHaveBeenCalled();
    expect(hookMocks.openExternal).not.toHaveBeenCalled();
  });
});
