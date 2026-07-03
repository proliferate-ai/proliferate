// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceOpenInWebActions } from "@/hooks/workspaces/workflows/remote-access/use-workspace-open-in-web-actions";

const hookMocks = vi.hoisted(() => ({
  copyText: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  selectedLogicalWorkspace: {
    cloudWorkspace: { id: "cloud-workspace-1" },
  } as { cloudWorkspace: { id: string } | null } | null,
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({
    copyText: hookMocks.copyText,
    openExternal: hookMocks.openExternal,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-selected-logical-workspace", () => ({
  useSelectedLogicalWorkspace: () => ({
    selectedLogicalWorkspace: hookMocks.selectedLogicalWorkspace,
    selectedLogicalWorkspaceId: null,
    isLoading: false,
  }),
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
    hookMocks.copyText.mockClear();
    hookMocks.openExternal.mockClear();
    hookMocks.showToast.mockClear();
    hookMocks.selectedLogicalWorkspace = {
      cloudWorkspace: { id: "cloud-workspace-1" },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("copies the link and shows feedback when opening the current workspace in web", async () => {
    const { result } = renderHook(() => useWorkspaceOpenInWebActions());

    act(() => {
      result.current.openCurrentWorkspaceInWeb();
    });

    const expectedUrl = "https://web.proliferate.com/cloud/workspaces/cloud-workspace-1";
    await waitFor(() => {
      expect(hookMocks.copyText).toHaveBeenCalledWith(expectedUrl);
      expect(hookMocks.openExternal).toHaveBeenCalledWith(expectedUrl);
      expect(hookMocks.showToast).toHaveBeenCalledWith(
        "Workspace link copied. Opening in web...",
        "info",
      );
    });
  });
});
