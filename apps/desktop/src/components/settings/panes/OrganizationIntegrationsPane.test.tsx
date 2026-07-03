// @vitest-environment jsdom

import type { AdminIntegrationDefinition } from "@proliferate/cloud-sdk/client/integrations";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationIntegrationsPane } from "./OrganizationIntegrationsPane";

const showToast = vi.hoisted(() => vi.fn());
const setEnabled = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const createDefinition = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const definitionsState = vi.hoisted(() => ({
  data: [] as AdminIntegrationDefinition[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganization: { id: "org-1", name: "Acme" },
    activeOrganizationId: "org-1",
    organizationsQuery: { isLoading: false },
  }),
}));
vi.mock("@/hooks/access/cloud/integrations/use-admin-integration-definitions", () => ({
  useAdminIntegrationDefinitions: () => definitionsState,
  useAdminIntegrationDefinitionActions: () => ({
    createDefinition,
    creatingDefinition: false,
    setEnabled,
  }),
}));
vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

function definition(overrides: Partial<AdminIntegrationDefinition> = {}): AdminIntegrationDefinition {
  return {
    definitionId: overrides.definitionId ?? "def-1",
    namespace: "linear",
    displayName: "Linear",
    description: null,
    authKind: "oauth2",
    authDetection: "declared",
    source: "seed",
    enabledByDefault: true,
    effectiveEnabled: true,
    policyEnabled: null,
    connectSchema: { secretFields: [], settingsFields: [] },
    ...overrides,
  } as AdminIntegrationDefinition;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  definitionsState.data = [];
  definitionsState.isLoading = false;
  definitionsState.isError = false;
});

describe("OrganizationIntegrationsPane search", () => {
  it("hides the search input when the list is short", () => {
    definitionsState.data = [definition()];
    render(<OrganizationIntegrationsPane />);

    expect(screen.queryByPlaceholderText("Search integrations")).toBeNull();
  });

  it("shows the search input and narrows rows once the list is long", () => {
    definitionsState.data = Array.from({ length: 8 }, (_, index) =>
      definition({ definitionId: `def-${index}`, displayName: `Provider ${index}`, namespace: `provider-${index}` }),
    );
    definitionsState.data.push(definition({ definitionId: "def-linear", displayName: "Linear", namespace: "linear" }));
    render(<OrganizationIntegrationsPane />);

    expect(screen.getByText("Provider 0")).toBeTruthy();
    expect(screen.getByText("Linear")).toBeTruthy();

    const input = screen.getByPlaceholderText("Search integrations");
    fireEvent.change(input, { target: { value: "linear" } });

    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.queryByText("Provider 0")).toBeNull();
  });

  it("shows a quiet empty state when nothing matches", () => {
    definitionsState.data = Array.from({ length: 8 }, (_, index) =>
      definition({ definitionId: `def-${index}`, displayName: `Provider ${index}`, namespace: `provider-${index}` }),
    );
    render(<OrganizationIntegrationsPane />);

    const input = screen.getByPlaceholderText("Search integrations");
    fireEvent.change(input, { target: { value: "no-match-xyz" } });

    expect(screen.getByText("No integrations found")).toBeTruthy();
  });
});
