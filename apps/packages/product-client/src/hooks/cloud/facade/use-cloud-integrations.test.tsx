// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCloudIntegrations } from "#product/hooks/cloud/facade/use-cloud-integrations";

// The facade composes the catalog + health hooks; capture the `enabled` option
// each receives so we can assert what gates the fetch. Integrations are an
// auth-plane surface, so a signed-in user must enable them even with NO cloud
// compute (E2B) — the PR 5f founder ruling.
type QueryOptions = { enabled?: boolean } | undefined;
const mocks = vi.hoisted(() => ({
  authStatus: "authenticated" as "authenticated" | "anonymous" | "loading",
  useIntegrationCatalog: vi.fn(
    (_organizationId?: string | null, _options?: { enabled?: boolean }) => ({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    }),
  ),
  useIntegrationHealth: vi.fn(
    (_organizationId?: string | null, _options?: { enabled?: boolean }) => ({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    }),
  ),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ authStatus: mocks.authStatus }),
}));
vi.mock("#product/hooks/access/cloud/integrations/use-integration-catalog", () => ({
  useIntegrationCatalog: mocks.useIntegrationCatalog,
}));
vi.mock("#product/hooks/access/cloud/integrations/use-integration-health", () => ({
  useIntegrationHealth: mocks.useIntegrationHealth,
  useInvalidateCloudIntegrations: () => vi.fn(),
}));
vi.mock("#product/hooks/access/cloud/integrations/use-integration-actions", () => ({
  useIntegrationActions: () => ({}),
}));
vi.mock("#product/hooks/access/cloud/integrations/use-integration-oauth-flow", () => ({
  useIntegrationOauthFlow: () => ({ data: undefined }),
}));

function lastEnabled(calls: ReadonlyArray<readonly unknown[]>): boolean {
  const call = calls[calls.length - 1];
  return (call?.[1] as QueryOptions)?.enabled ?? false;
}
const catalogEnabled = () => lastEnabled(mocks.useIntegrationCatalog.mock.calls);
const healthEnabled = () => lastEnabled(mocks.useIntegrationHealth.mock.calls);

afterEach(() => {
  vi.clearAllMocks();
  mocks.authStatus = "authenticated";
});

describe("useCloudIntegrations gating", () => {
  it("enables the catalog + health fetch for a signed-in user without cloud compute", () => {
    mocks.authStatus = "authenticated";
    renderHook(() => useCloudIntegrations("org-1"));

    expect(catalogEnabled()).toBe(true);
    expect(healthEnabled()).toBe(true);
  });

  it("keeps the fetch disabled while signed out", () => {
    mocks.authStatus = "anonymous";
    renderHook(() => useCloudIntegrations("org-1"));

    expect(catalogEnabled()).toBe(false);
    expect(healthEnabled()).toBe(false);
  });

  it("still honors an explicit disabled override when authenticated", () => {
    mocks.authStatus = "authenticated";
    renderHook(() => useCloudIntegrations("org-1", { enabled: false }));

    expect(catalogEnabled()).toBe(false);
    expect(healthEnabled()).toBe(false);
  });
});
