// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateCloudWorkspace } from "./use-create-cloud-workspace";

const createMocks = vi.hoisted(() => ({
  validateAuthority: vi.fn(),
  createWorkspace: vi.fn(),
  beginPendingWorkspace: vi.fn(),
  failPendingEntry: vi.fn(),
  finalizeSelection: vi.fn(),
  setPendingWorkspaceEntry: vi.fn(),
  selectWorkspace: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useValidateGitHubRepoAuthority: () => ({
    mutateAsync: createMocks.validateAuthority,
    isPending: false,
  }),
}));

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({
  createCloudWorkspace: createMocks.createWorkspace,
}));

vi.mock("@/hooks/access/cloud/use-cloud-workspace-connection-cache", () => ({
  useCloudWorkspaceConnectionCache: () => ({
    clearCachedCloudWorkspaceConnections: vi.fn(),
  }),
}));

vi.mock("@/hooks/access/cloud/use-cloud-billing", () => ({
  useInvalidateCloudBillingState: () => vi.fn(),
}));

vi.mock("@/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: createMocks.selectWorkspace }),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-entry-flow", () => ({
  useWorkspaceEntryFlow: () => ({
    beginPendingWorkspace: createMocks.beginPendingWorkspace,
    failPendingEntry: createMocks.failPendingEntry,
    finalizeSelection: createMocks.finalizeSelection,
  }),
}));

vi.mock("@/hooks/workspaces/cache/use-workspace-collections-cache", () => ({
  useWorkspaceCollectionsCache: () => ({
    getWorkspaceCollections: () => ({ cloudWorkspaces: [] }),
  }),
}));

vi.mock("@/hooks/workspaces/cache/use-workspace-collections-mutation-cache", () => ({
  useWorkspaceCollectionsMutationCache: () => ({ upsertCloudWorkspace: vi.fn() }),
}));

vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: { runtimeUrl: string }) => unknown) =>
    selector({ runtimeUrl: "http://runtime.test" }),
}));

vi.mock("@/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (selector: (state: { branchPrefixType: "proliferate" }) => unknown) =>
    selector({ branchPrefixType: "proliferate" }),
}));

vi.mock("@/stores/auth/auth-store", () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));

vi.mock("@/stores/sessions/session-selection-store", () => {
  const store = (selector: (state: {
    setPendingWorkspaceEntry: typeof createMocks.setPendingWorkspaceEntry;
  }) => unknown) => selector({
    setPendingWorkspaceEntry: createMocks.setPendingWorkspaceEntry,
  });
  store.getState = () => ({
    pendingWorkspaceEntry: null,
    selectedWorkspaceId: null,
  });
  return { useSessionSelectionStore: store };
});

vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: vi.fn(),
  trackProductEvent: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useCreateCloudWorkspace GitHub App preflight", () => {
  beforeEach(() => {
    createMocks.validateAuthority.mockReset();
    createMocks.createWorkspace.mockReset();
    createMocks.beginPendingWorkspace.mockReset();
    createMocks.failPendingEntry.mockReset();
    createMocks.finalizeSelection.mockReset();
    createMocks.setPendingWorkspaceEntry.mockReset();
    createMocks.selectWorkspace.mockReset();
  });

  afterEach(cleanup);

  it("does not create an optimistic entry or call create when repo authority is absent", async () => {
    createMocks.validateAuthority.mockResolvedValue({
      authorized: false,
      status: "missing_user_authorization",
      action: "authorize_user",
      message: "Connect the Proliferate GitHub App.",
    });
    const { result } = renderHook(() => useCreateCloudWorkspace(), { wrapper });

    const response = await act(() => result.current.createCloudWorkspaceAndEnterWithResult({
      gitOwner: "acme",
      gitRepoName: "rocket",
      baseBranch: "main",
    }));

    expect(response).toEqual({
      status: "interrupted",
      failureMessage: "Connect GitHub App to use cloud workspaces",
    });
    expect(createMocks.beginPendingWorkspace).not.toHaveBeenCalled();
    expect(createMocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("fails closed when the authority check itself is unavailable", async () => {
    createMocks.validateAuthority.mockRejectedValue(new Error("GitHub is unavailable"));
    const { result } = renderHook(() => useCreateCloudWorkspace(), { wrapper });

    const response = await act(() => result.current.createCloudWorkspaceAndEnterWithResult({
      gitOwner: "acme",
      gitRepoName: "rocket",
    }));

    expect(response).toEqual({
      status: "interrupted",
      failureMessage: "GitHub is unavailable",
    });
    expect(createMocks.beginPendingWorkspace).not.toHaveBeenCalled();
    expect(createMocks.createWorkspace).not.toHaveBeenCalled();
  });
});
