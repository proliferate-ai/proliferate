// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationHealthItem } from "@proliferate/cloud-sdk/client/integrations";
import { useIntegrationReauthState } from "./use-integration-reauth-state";

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

describe("useIntegrationReauthState", () => {
  it("is hidden while health has not loaded", () => {
    stubHealth(undefined);
    const { result } = renderHook(() => useIntegrationReauthState());

    expect(result.current).toEqual({ providerNames: [], label: null, visible: false });
  });

  it("is hidden when every connected provider is healthy", () => {
    stubHealth([
      makeHealthItem(),
      makeHealthItem({ definitionId: "def-2", accountId: null, health: "needs_auth" }),
    ]);
    const { result } = renderHook(() => useIntegrationReauthState());

    expect(result.current.visible).toBe(false);
    expect(result.current.label).toBeNull();
  });

  it("names the single provider needing reauth", () => {
    stubHealth([
      makeHealthItem(),
      makeHealthItem({ definitionId: "def-2", displayName: "Notion", health: "needs_reauth" }),
    ]);
    const { result } = renderHook(() => useIntegrationReauthState());

    expect(result.current.visible).toBe(true);
    expect(result.current.providerNames).toEqual(["Notion"]);
    expect(result.current.label).toBe("Notion needs re-authentication");
  });

  it("collapses several providers into a count", () => {
    stubHealth([
      makeHealthItem({ health: "needs_reauth" }),
      makeHealthItem({ definitionId: "def-2", displayName: "Notion", health: "needs_reauth" }),
    ]);
    const { result } = renderHook(() => useIntegrationReauthState());

    expect(result.current.label).toBe("2 integrations need re-authentication");
  });

  it("scopes the health query to the active organization and stays quiet on cadence", () => {
    stubHealth([]);
    renderHook(() => useIntegrationReauthState());

    expect(mocks.useIntegrationHealth).toHaveBeenCalledWith("org-1", {
      enabled: true,
      refetchInterval: 5 * 60_000,
      refetchOnWindowFocus: true,
    });
  });

  it("disables the query when cloud is inactive", () => {
    mocks.cloudActive = false;
    stubHealth([]);
    renderHook(() => useIntegrationReauthState());

    expect(mocks.useIntegrationHealth).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ enabled: false }),
    );
  });
});
