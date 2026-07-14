// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

const sdkMocks = vi.hoisted(() => ({
  listOrganizations: vi.fn(),
  acceptOrganizationInvitation: vi.fn(),
  getIntegrationCatalog: vi.fn(),
  removeIntegrationAccount: vi.fn(),
  getCloudWorktreeRetentionPolicy: vi.fn(),
  putCloudWorktreeRetentionPolicy: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/organizations", async (importOriginal) => ({
  ...await importOriginal<typeof import("@proliferate/cloud-sdk/client/organizations")>(),
  listOrganizations: sdkMocks.listOrganizations,
  acceptOrganizationInvitation: sdkMocks.acceptOrganizationInvitation,
}));
vi.mock("@proliferate/cloud-sdk/client/integrations", async (importOriginal) => ({
  ...await importOriginal<typeof import("@proliferate/cloud-sdk/client/integrations")>(),
  getIntegrationCatalog: sdkMocks.getIntegrationCatalog,
  removeIntegrationAccount: sdkMocks.removeIntegrationAccount,
}));
vi.mock("@proliferate/cloud-sdk/client/worktree-policy", async (importOriginal) => ({
  ...await importOriginal<typeof import("@proliferate/cloud-sdk/client/worktree-policy")>(),
  getCloudWorktreeRetentionPolicy: sdkMocks.getCloudWorktreeRetentionPolicy,
  putCloudWorktreeRetentionPolicy: sdkMocks.putCloudWorktreeRetentionPolicy,
}));

import { useIntegrationActions } from "./integrations/use-integration-actions";
import { useIntegrationCatalog } from "./integrations/use-integration-catalog";
import { useOrganizationActions } from "./organizations/use-organization-actions";
import { useOrganizations } from "./organizations/use-organizations";
import {
  useCloudWorktreeRetentionPolicy,
  usePutCloudWorktreeRetentionPolicy,
} from "./use-cloud-worktree-retention-policy";

function host(cloudClient: ProliferateCloudClient | null): ProductHost {
  return {
    deployment: { apiBaseUrl: "https://api.test" },
    auth: {
      state: {
        status: "authenticated",
        user: { id: "user-1" },
        readiness: { status: "ready" },
      },
    },
    cloud: { client: cloudClient },
    desktop: null,
  } as ProductHost;
}

function wrapper(productHost: ProductHost) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <ProductHostProvider host={productHost}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ProductHostProvider>
  );
}

describe("host cloud client authority", () => {
  it("does not dispatch queries or mutations through an SDK fallback when host client is null", async () => {
    const nullWrapper = wrapper(host(null));
    renderHook(() => useOrganizations(), { wrapper: nullWrapper });
    renderHook(() => useIntegrationCatalog(null), { wrapper: nullWrapper });
    renderHook(() => useCloudWorktreeRetentionPolicy(), { wrapper: nullWrapper });
    const organizationActions = renderHook(() => useOrganizationActions(null), {
      wrapper: nullWrapper,
    });
    const integrationActions = renderHook(() => useIntegrationActions(), {
      wrapper: nullWrapper,
    });
    const retentionAction = renderHook(() => usePutCloudWorktreeRetentionPolicy(), {
      wrapper: nullWrapper,
    });

    await expect(
      organizationActions.result.current.acceptInvitation("org-1"),
    ).rejects.toThrow("Cloud access is unavailable for this host.");
    await expect(
      integrationActions.result.current.disconnect("account-1"),
    ).rejects.toThrow("Cloud access is unavailable for this host.");
    await expect(
      retentionAction.result.current.mutateAsync({ maxMaterializedWorktreesPerRepo: 3 }),
    ).rejects.toThrow("Cloud access is unavailable for this host.");

    expect(sdkMocks.listOrganizations).not.toHaveBeenCalled();
    expect(sdkMocks.getIntegrationCatalog).not.toHaveBeenCalled();
    expect(sdkMocks.getCloudWorktreeRetentionPolicy).not.toHaveBeenCalled();
    expect(sdkMocks.acceptOrganizationInvitation).not.toHaveBeenCalled();
    expect(sdkMocks.removeIntegrationAccount).not.toHaveBeenCalled();
    expect(sdkMocks.putCloudWorktreeRetentionPolicy).not.toHaveBeenCalled();
  });

  it("passes the exact host client to each active cloud query", async () => {
    const cloudClient = {} as ProliferateCloudClient;
    sdkMocks.listOrganizations.mockResolvedValue({ organizations: [] });
    sdkMocks.getIntegrationCatalog.mockResolvedValue({ items: [] });
    sdkMocks.getCloudWorktreeRetentionPolicy.mockResolvedValue({
      maxMaterializedWorktreesPerRepo: 3,
      updatedAt: "2026-07-14T00:00:00Z",
      source: "user",
    });
    const exactWrapper = wrapper(host(cloudClient));

    renderHook(() => useOrganizations(), { wrapper: exactWrapper });
    renderHook(() => useIntegrationCatalog(null), { wrapper: exactWrapper });
    renderHook(() => useCloudWorktreeRetentionPolicy(), { wrapper: exactWrapper });

    await waitFor(() => {
      expect(sdkMocks.listOrganizations).toHaveBeenCalledWith(cloudClient);
      expect(sdkMocks.getIntegrationCatalog).toHaveBeenCalledWith(
        { organizationId: null },
        cloudClient,
      );
      expect(sdkMocks.getCloudWorktreeRetentionPolicy).toHaveBeenCalledWith(cloudClient);
    });
  });
});
