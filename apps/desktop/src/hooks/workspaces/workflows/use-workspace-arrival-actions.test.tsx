// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";

import { useWorkspaceArrivalActions } from "./use-workspace-arrival-actions";

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn().mockResolvedValue(undefined),
  listOpenTargets: vi.fn().mockResolvedValue([]),
  navigate: vi.fn(),
  openTarget: vi.fn().mockResolvedValue(undefined),
  setWorkspaceArrivalEvent: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    clipboard: { writeText: mocks.clipboardWriteText },
    desktop: {
      files: {
        listOpenTargets: mocks.listOpenTargets,
        openTarget: mocks.openTarget,
      },
    },
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof mocks.showToast }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: { setWorkspaceArrivalEvent: typeof mocks.setWorkspaceArrivalEvent }) => unknown,
  ) => selector({ setWorkspaceArrivalEvent: mocks.setWorkspaceArrivalEvent }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.clipboardWriteText.mockResolvedValue(undefined);
  mocks.listOpenTargets.mockResolvedValue([]);
  mocks.openTarget.mockResolvedValue(undefined);
});

describe("useWorkspaceArrivalActions", () => {
  it("routes copy targets through the shared clipboard", async () => {
    const copyTarget: OpenTarget = {
      id: "copy-path",
      label: "Copy path",
      kind: "copy",
    };
    const { result } = renderHook(() => useWorkspaceArrivalActions({
      workspacePath: "/repo",
      sourceRepoRootPath: null,
    }));

    act(() => result.current.handleTargetClick(copyTarget));

    await waitFor(() => {
      expect(mocks.clipboardWriteText).toHaveBeenCalledWith("/repo");
    });
    expect(mocks.openTarget).not.toHaveBeenCalled();
  });

  it("retains the Desktop file bridge for native open targets", async () => {
    const editorTarget: OpenTarget = {
      id: "cursor",
      label: "Cursor",
      kind: "editor",
      iconId: "cursor",
    };
    const { result } = renderHook(() => useWorkspaceArrivalActions({
      workspacePath: "/repo",
      sourceRepoRootPath: null,
    }));

    act(() => result.current.handleTargetClick(editorTarget));

    await waitFor(() => {
      expect(mocks.openTarget).toHaveBeenCalledWith("cursor", "/repo");
    });
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled();
  });
});
