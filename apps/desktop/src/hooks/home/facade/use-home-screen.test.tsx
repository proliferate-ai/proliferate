// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useHomeScreen } from "@/hooks/home/facade/use-home-screen";

const mocks = vi.hoisted(() => {
  const getItem = vi.fn(async () => null);
  const setItem = vi.fn(async () => undefined);
  return {
    getItem,
    setItem,
    context: {
      storage: {
        getItem,
        setItem,
        removeItem: vi.fn(async () => undefined),
      },
      captureException: vi.fn(),
    },
  };
});

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: () => ({ data: { repositories: [] }, isPending: false }),
}));
vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({ readyAgents: [], isLoading: false, isReconciling: false }),
}));
vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false }),
}));
vi.mock("@/hooks/workspaces/workflows/use-add-repo", () => ({
  useAddRepo: () => ({ isAddingRepo: false }),
}));
vi.mock("@/stores/ui/add-repo-flow-store", () => ({
  useAddRepoFlowStore: (selector: (state: { openFlow: () => void }) => unknown) =>
    selector({ openFlow: vi.fn() }),
}));
vi.mock("@/hooks/workspaces/derived/use-standard-repo-projection", () => ({
  useStandardRepoProjection: () => ({
    localWorkspaces: [],
    repoRoots: [],
    isLoading: false,
  }),
}));
vi.mock("@/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (selector: (state: { defaultChatAgentKind: string }) => unknown) =>
    selector({ defaultChatAgentKind: "claude" }),
}));
vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: { hiddenRepoRootIds: string[] }) => unknown) =>
    selector({ hiddenRepoRootIds: [] }),
}));
vi.mock("@/hooks/app/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => mocks.context,
}));

afterEach(() => {
  cleanup();
  mocks.getItem.mockClear();
  mocks.setItem.mockClear();
});

describe("useHomeScreen model-probe persistence", () => {
  it("delegates the exact dismissal key and value to ProductStorage", async () => {
    const rendered = renderHook(() => useHomeScreen());
    await waitFor(() => {
      expect(mocks.getItem).toHaveBeenCalledWith(
        "proliferate.home.modelProbeCardDismissed",
      );
    });

    act(() => rendered.result.current.dismissModelProbeCard());
    await waitFor(() => {
      expect(mocks.setItem).toHaveBeenCalledWith(
        "proliferate.home.modelProbeCardDismissed",
        "1",
      );
    });
    expect(rendered.result.current.modelProbeInputs.dismissed).toBe(true);
  });
});
