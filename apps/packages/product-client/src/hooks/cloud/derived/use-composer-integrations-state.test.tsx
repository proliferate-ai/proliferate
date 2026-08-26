// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationHealthItem } from "@proliferate/cloud-sdk/client/integrations";
import { useComposerIntegrationsState } from "#product/hooks/cloud/derived/use-composer-integrations-state";

// File default is the shipped production posture: cloud COMPUTE disabled,
// user signed in, control plane reachable. Integration health is a
// control-plane feature and must stay live in exactly this posture (IG-1,
// delivery/triage/2026-08-25-integrations-agent-auth.md) — every test below
// doubles as the regression guard against re-coupling to cloud compute.
const mocks = vi.hoisted(() => ({
  useIntegrationHealth: vi.fn(),
  authStatus: "authenticated" as string,
  controlPlaneReachable: true,
}));

vi.mock("#product/hooks/access/cloud/integrations/use-integration-health", () => ({
  useIntegrationHealth: mocks.useIntegrationHealth,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    authStatus: mocks.authStatus,
    controlPlaneReachable: mocks.controlPlaneReachable,
    // The shipped launch posture: compute off. The hook must not read these,
    // but the mock carries them so a re-coupling regression sees the same
    // values production does and fails the query-enabled assertions below.
    cloudComputeEnabled: false,
    cloudActive: false,
  }),
}));

vi.mock("#product/hooks/organizations/facade/use-active-organization", () => ({
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
  mocks.authStatus = "authenticated";
  mocks.controlPlaneReachable = true;
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

  it("keeps the health query live with cloud compute disabled", () => {
    // The IG-1 regression: gating on cloudActive disabled this query for
    // every signed-in production user. The file-default mock is exactly that
    // posture (compute off, authenticated, reachable) — the query must run.
    stubHealth([]);
    renderHook(() => useComposerIntegrationsState());

    expect(mocks.useIntegrationHealth).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("disables the query when signed out", () => {
    mocks.authStatus = "anonymous";
    stubHealth([]);
    renderHook(() => useComposerIntegrationsState());

    expect(mocks.useIntegrationHealth).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("disables the query when the control plane is unreachable", () => {
    mocks.controlPlaneReachable = false;
    stubHealth([]);
    renderHook(() => useComposerIntegrationsState());

    expect(mocks.useIntegrationHealth).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ enabled: false }),
    );
  });
});
