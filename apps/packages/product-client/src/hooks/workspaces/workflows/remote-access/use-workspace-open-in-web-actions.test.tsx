// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceOpenInWebActions } from "#product/hooks/workspaces/workflows/remote-access/use-workspace-open-in-web-actions";

const hookMocks = vi.hoisted(() => ({
  copyText: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  selectedLogicalWorkspace: {
    cloudWorkspace: { id: "cloud-workspace-1" },
    mobilityWorkspace: null,
  } as { cloudWorkspace: { id: string } | null; mobilityWorkspace: { cloudWorkspaceId: string } | null } | null,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: hookMocks.copyText },
    links: { openExternal: hookMocks.openExternal },
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-selected-logical-workspace", () => ({
  useSelectedLogicalWorkspace: () => ({
    selectedLogicalWorkspace: hookMocks.selectedLogicalWorkspace,
    selectedLogicalWorkspaceId: null,
    isLoading: false,
  }),
}));

const webAppMocks = vi.hoisted(() => ({
  webApp: { available: true, baseUrl: "https://web.proliferate.com" } as {
    available: boolean;
    baseUrl: string | null;
  },
}));

vi.mock("#product/hooks/capabilities/derived/use-web-app-target", () => ({
  useWebAppTarget: () => webAppMocks.webApp,
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string, type?: "error" | "info") => void }) => unknown) =>
    selector({ show: hookMocks.showToast }),
}));

describe("useWorkspaceOpenInWebActions", () => {
  beforeEach(() => {
    hookMocks.copyText.mockClear();
    hookMocks.openExternal.mockClear();
    hookMocks.showToast.mockClear();
    hookMocks.selectedLogicalWorkspace = {
      cloudWorkspace: { id: "cloud-workspace-1" },
      mobilityWorkspace: null,
    };
    webAppMocks.webApp = { available: true, baseUrl: "https://web.proliferate.com" };
  });

  afterEach(() => {
    cleanup();
  });

  it("stays disabled even with a web app available (the cloud deep link died with the cloud stack)", () => {
    const { result } = renderHook(() => useWorkspaceOpenInWebActions());

    expect(result.current.disabled).toBe(true);
    expect(result.current.url).toBeNull();

    act(() => {
      result.current.openCurrentWorkspaceInWeb();
    });

    expect(hookMocks.copyText).not.toHaveBeenCalled();
    expect(hookMocks.openExternal).not.toHaveBeenCalled();
    expect(hookMocks.showToast).toHaveBeenCalledWith("Opening workspaces on the web is no longer available.");
  });

  it("disables the action and never opens anything when this deployment has no web app", () => {
    webAppMocks.webApp = { available: false, baseUrl: null };
    const { result } = renderHook(() => useWorkspaceOpenInWebActions());

    expect(result.current.disabled).toBe(true);
    expect(result.current.disabledReason).toBe("The web app is not available for this server.");
    expect(result.current.url).toBeNull();

    act(() => {
      result.current.openCurrentWorkspaceInWeb();
    });

    expect(hookMocks.copyText).not.toHaveBeenCalled();
    expect(hookMocks.openExternal).not.toHaveBeenCalled();
    expect(hookMocks.showToast).toHaveBeenCalledWith("The web app is not available for this server.");
  });
});
