// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceOpenInWebActions } from "@/hooks/workspaces/remote-access/use-workspace-open-in-web-actions";

const hookMocks = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  mobility: {
    selectionLocked: false,
    selectedLogicalWorkspace: {
      cloudWorkspace: { id: "cloud-workspace-1" },
      mobilityWorkspace: null,
    },
  },
}));

vi.mock("@proliferate/cloud-sdk", () => ({
  webWorkspaceDeepLink: (workspaceId: string, baseUrl: string) =>
    `${baseUrl}/workspaces/${workspaceId}`,
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({
    openExternal: hookMocks.openExternal,
  }),
}));

vi.mock("@/hooks/workspaces/mobility/use-workspace-mobility-state", () => ({
  useWorkspaceMobilityState: () => hookMocks.mobility,
}));

vi.mock("@/lib/infra/proliferate-web", () => ({
  getProliferateWebBaseUrl: () => "https://web.proliferate.com",
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string, type?: "error" | "info") => void }) => unknown) =>
    selector({ show: hookMocks.showToast }),
}));

describe("useWorkspaceOpenInWebActions", () => {
  beforeEach(() => {
    hookMocks.openExternal.mockClear();
    hookMocks.showToast.mockClear();
    hookMocks.mobility.selectionLocked = false;
    hookMocks.mobility.selectedLogicalWorkspace = {
      cloudWorkspace: { id: "cloud-workspace-1" },
      mobilityWorkspace: null,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("shows feedback when opening the current workspace in web", () => {
    const { result } = renderHook(() => useWorkspaceOpenInWebActions());

    act(() => {
      result.current.openCurrentWorkspaceInWeb();
    });

    expect(hookMocks.openExternal).toHaveBeenCalledWith(
      "https://web.proliferate.com/workspaces/cloud-workspace-1",
    );
    expect(hookMocks.showToast).toHaveBeenCalledWith(
      "Opening workspace in web...",
      "info",
    );
  });
});
