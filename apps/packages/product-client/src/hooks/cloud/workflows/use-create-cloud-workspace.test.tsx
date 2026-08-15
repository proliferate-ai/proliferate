// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudWorkspaceRepoTarget } from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { useCreateCloudWorkspace } from "#product/hooks/cloud/workflows/use-create-cloud-workspace";

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCreateCloudWorkspace(), { wrapper });
}

const mocks = vi.hoisted(() => ({
  createCloudWorkspace: vi.fn(),
  beginPendingWorkspace: vi.fn(() => "projected-session"),
  failPendingEntry: vi.fn(),
  finalizeSelection: vi.fn(),
  selectWorkspace: vi.fn(),
  clearCachedCloudWorkspaceConnections: vi.fn(),
  invalidateCloudBillingState: vi.fn(),
  getWorkspaceCollections: vi.fn(() => ({ cloudWorkspaces: [] })),
  upsertCloudWorkspace: vi.fn(),
  cloudComputeEnabled: true,
}));

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({
  createCloudWorkspace: (...args: unknown[]) => mocks.createCloudWorkspace(...args),
}));

vi.mock("#product/hooks/access/cloud/use-cloud-workspace-connection-cache", () => ({
  useCloudWorkspaceConnectionCache: () => ({
    clearCachedCloudWorkspaceConnections: mocks.clearCachedCloudWorkspaceConnections,
  }),
}));

vi.mock("#product/hooks/access/cloud/use-cloud-billing", () => ({
  useInvalidateCloudBillingState: () => mocks.invalidateCloudBillingState,
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-entry-flow", () => ({
  useWorkspaceEntryFlow: () => ({
    beginPendingWorkspace: mocks.beginPendingWorkspace,
    failPendingEntry: mocks.failPendingEntry,
    finalizeSelection: mocks.finalizeSelection,
  }),
}));

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthUser: () => null,
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({ cloudComputeEnabled: mocks.cloudComputeEnabled }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-cache", () => ({
  useWorkspaceCollectionsCache: () => ({
    getWorkspaceCollections: mocks.getWorkspaceCollections,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-mutation-cache", () => ({
  useWorkspaceCollectionsMutationCache: () => ({
    upsertCloudWorkspace: mocks.upsertCloudWorkspace,
  }),
}));

vi.mock("#product/hooks/telemetry/facade/use-product-telemetry", () => ({
  useProductTelemetry: () => ({
    track: vi.fn(),
    captureException: vi.fn(),
  }),
}));

function target(): CloudWorkspaceRepoTarget {
  return {
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    baseBranch: "main",
  };
}

describe("useCreateCloudWorkspace / runCloudWorkspaceCreateFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudComputeEnabled = true;
    mocks.getWorkspaceCollections.mockReturnValue({ cloudWorkspaces: [] });
    mocks.beginPendingWorkspace.mockReturnValue("projected-session");
  });

  afterEach(cleanup);

  // PRO-10 round-3 finding: the Retry path had no capability gate at all —
  // it went straight from the receipt to createCloudWorkspaceMutation. This
  // is gate layer 1, inside the flow every create/retry entry point funnels
  // through.
  it("refuses to create a cloud workspace when cloudComputeEnabled is false", async () => {
    mocks.cloudComputeEnabled = false;
    const { result } = renderWithQueryClient();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.createCloudWorkspaceAndEnterWithResult(target());
    });

    expect(mocks.createCloudWorkspace).not.toHaveBeenCalled();
    expect(mocks.failPendingEntry).toHaveBeenCalledTimes(1);
    expect(mocks.failPendingEntry.mock.calls[0][1]).toBe(
      "Cloud workspaces are temporarily unavailable.",
    );
    expect(outcome).toEqual({
      status: "interrupted",
      failureMessage: "Cloud workspaces are temporarily unavailable.",
    });
  });

  it("refuses the retry entry point too when cloudComputeEnabled is false", async () => {
    mocks.cloudComputeEnabled = false;
    const { result } = renderWithQueryClient();

    await act(async () => {
      await result.current.retryCloudWorkspaceAndEnter({
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
        baseBranch: "main",
        branchName: "pablo/retry",
        generatedName: false,
      });
    });

    expect(mocks.createCloudWorkspace).not.toHaveBeenCalled();
    expect(mocks.failPendingEntry).toHaveBeenCalledTimes(1);
  });

  // Negative control: with the capability enabled, the mutation still runs —
  // proves the gate isn't just always short-circuiting the flow.
  it("proceeds to create the mutation when cloudComputeEnabled is true", async () => {
    mocks.createCloudWorkspace.mockResolvedValue({
      id: "cloud-1",
      status: "ready",
      repo: { provider: "github", baseBranch: "main" },
    });
    const { result } = renderWithQueryClient();

    await act(async () => {
      await result.current.createCloudWorkspaceAndEnterWithResult(target());
    });

    expect(mocks.createCloudWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.failPendingEntry).not.toHaveBeenCalled();
  });
});
