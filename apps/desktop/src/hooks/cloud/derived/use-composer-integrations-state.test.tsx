// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationHealthItem } from "@proliferate/cloud-sdk/client/integrations";
import { useComposerIntegrationsState } from "./use-composer-integrations-state";

const mocks = vi.hoisted(() => ({
  useIntegrationHealth: vi.fn(),
  cloudActive: true,
}));

vi.mock("@/hooks/access/cloud/integrations/use-integration-health", () => ({
  useIntegrationHealth: mocks.useIntegrationHealth,
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: mocks.cloudActive }),
}));

vi.mock("@/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({ activeOrganizationId: "org-1" }),
}));

function makeHealthItem(
  overrides: Partial<IntegrationHealthItem> = {},
): IntegrationHealthItem {
  return {
    definitionId: "def-1",
    accountId: "acc-1",
    namespace: "linear",
    displayName: "Linear",
    authKind: "oauth2",
    effectiveEnabled: true,
    policyEnabled: null,
    accountEnabled: true,
    health: "ready",
    tokenExpiresAt: null,
    toolCount: 3,
    lastErrorCode: null,
    ...overrides,
  };
}

function stubHealth(items: IntegrationHealthItem[] | undefined) {
  mocks.useIntegrationHealth.mockReturnValue({
    data: items === undefined ? undefined : { items },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.cloudActive = true;
});

describe("useComposerIntegrationsState", () => {
  it("is hidden while health has not loaded", () => {
    stubHealth(undefined);
    const { result } = renderHook(() => useComposerIntegrationsState());

    expect(result.current.mode).toBe("hidden");
    expect(result.current.connectedCount).toBe(0);
  });

  it("is quiet when every connected provider is healthy", () => {
    stubHealth([
      makeHealthItem(),
      makeHealthItem({ definitionId: "def-2", displayName: "Notion", accountId: null, health: "needs_auth" }),
    ]);
    const { result } = renderHook(() => useComposerIntegrationsState());

    expect(result.current.mode).toBe("quiet");
    expect(result.current.connectedCount).toBe(1);
    expect(result.current.reauthLabel).toBeNull();
  });

  it("is urgent and names the provider needing reauth", () => {
    stubHealth([
      makeHealthItem(),
      makeHealthItem({ definitionId: "def-2", displayName: "Notion", health: "needs_reauth" }),
    ]);
    const { result } = renderHook(() => useComposerIntegrationsState());

    expect(result.current.mode).toBe("urgent");
    expect(result.current.reauthLabel).toBe("Notion needs re-authentication");
  });

  it("scopes the health query to the active organization and stays quiet on cadence", () => {
    stubHealth([]);
    renderHook(() => useComposerIntegrationsState());

    expect(mocks.useIntegrationHealth).toHaveBeenCalledWith("org-1", {
      enabled: true,
      refetchInterval: 5 * 60_000,
      refetchOnWindowFocus: true,
    });
  });

  it("disables the query when cloud is inactive", () => {
    mocks.cloudActive = false;
    stubHealth([]);
    renderHook(() => useComposerIntegrationsState());

    expect(mocks.useIntegrationHealth).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ enabled: false }),
    );
  });
});
