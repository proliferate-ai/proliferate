// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRemoteAccessActions } from "@/hooks/workspaces/workflows/remote-access/use-workspace-remote-access-actions";

const hookMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string, type?: "error" | "info") => void }) => unknown) =>
    selector({ show: hookMocks.showToast }),
}));

describe("useWorkspaceRemoteAccessActions", () => {
  beforeEach(() => {
    hookMocks.showToast.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the removed remote-access flow disabled", () => {
    const { result } = renderHook(() => useWorkspaceRemoteAccessActions());

    expect(result.current.disabled).toBe(true);
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.syncToWebDisabledReason).toContain("managed sandbox gateway");

    act(() => {
      result.current.syncToWeb();
    });

    expect(hookMocks.showToast).toHaveBeenCalledWith(
      "Cloud workspaces now open through the managed sandbox gateway.",
      "info",
    );
  });
});
