// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudIntegrationView } from "@/lib/domain/cloud/integrations";
import { UserIntegrationsPane } from "./UserIntegrationsPane";

const showToast = vi.hoisted(() => vi.fn());
const authenticate = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
const disconnect = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const cancelOauthFlow = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const invalidateCloudIntegrations = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const integrationsState = vi.hoisted(() => ({
  integrations: [] as CloudIntegrationView[],
  isLoading: false,
  isError: false,
  catalogQuery: { refetch: vi.fn() },
  healthQuery: { refetch: vi.fn() },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({ activeOrganizationId: "org-1" }),
}));
vi.mock("@/hooks/cloud/facade/use-cloud-integrations", () => ({
  useCloudIntegrations: () => integrationsState,
  useCloudIntegrationActions: () => ({
    authenticate,
    authenticating: false,
    disconnect,
    disconnecting: false,
    cancelOauthFlow,
    cancellingOauthFlow: false,
    invalidateCloudIntegrations,
  }),
  useCloudIntegrationOauthFlow: () => ({ data: undefined }),
}));
vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ links: { openExternal } }),
}));
vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

function integration(overrides: Partial<CloudIntegrationView> = {}): CloudIntegrationView {
  return {
    definitionId: overrides.definitionId ?? "def-1",
    namespace: "linear",
    displayName: "Linear",
    description: null,
    authKind: "oauth2",
    connectSchema: { secretFields: [], settingsFields: [] },
    accountId: null,
    health: "needs_auth",
    effectiveEnabled: true,
    policyEnabled: null,
    accountEnabled: null,
    tokenExpiresAt: null,
    toolCount: null,
    lastErrorCode: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  integrationsState.integrations = [];
  integrationsState.isLoading = false;
  integrationsState.isError = false;
});

describe("UserIntegrationsPane search", () => {
  it("hides the search input when the list is short", () => {
    integrationsState.integrations = [integration()];
    render(<UserIntegrationsPane />);

    expect(screen.queryByPlaceholderText("Search integrations")).toBeNull();
  });

  it("shows the search input and narrows rows once the list is long", () => {
    integrationsState.integrations = Array.from({ length: 8 }, (_, index) =>
      integration({ definitionId: `def-${index}`, displayName: `Provider ${index}`, namespace: `provider-${index}` }),
    );
    integrationsState.integrations.push(
      integration({ definitionId: "def-linear", displayName: "Linear", namespace: "linear" }),
    );
    render(<UserIntegrationsPane />);

    expect(screen.getByText("Provider 0")).toBeTruthy();
    expect(screen.getByText("Linear")).toBeTruthy();

    const input = screen.getByPlaceholderText("Search integrations");
    fireEvent.change(input, { target: { value: "linear" } });

    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.queryByText("Provider 0")).toBeNull();
  });

  it("drops the stale query and shows every row when the list shrinks below the threshold", () => {
    integrationsState.integrations = Array.from({ length: 8 }, (_, index) =>
      integration({ definitionId: `def-${index}`, displayName: `Provider ${index}`, namespace: `provider-${index}` }),
    );
    const { rerender } = render(<UserIntegrationsPane />);

    const input = screen.getByPlaceholderText("Search integrations");
    fireEvent.change(input, { target: { value: "no-match-xyz" } });
    expect(screen.getByText("No integrations found")).toBeTruthy();

    // The list shrinks below the threshold: the input hides and the stale query
    // must stop filtering so the short list is not left showing a phantom
    // "No integrations found" with no visible cause.
    integrationsState.integrations = [
      integration({ definitionId: "def-0", displayName: "Provider 0", namespace: "provider-0" }),
    ];
    rerender(<UserIntegrationsPane />);

    expect(screen.queryByPlaceholderText("Search integrations")).toBeNull();
    expect(screen.queryByText("No integrations found")).toBeNull();
    expect(screen.getByText("Provider 0")).toBeTruthy();
  });
});
