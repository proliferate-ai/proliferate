import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorCatalogPage } from "./ConnectorCatalogPage";

const connectorsCatalogState = vi.hoisted(() => {
  const baseState = () => ({
    availableCards: [],
    closeModal: vi.fn(),
    connected: [],
    firstRunEmpty: false,
    isLoading: false,
    isSearching: false,
    loadError: null as string | null,
    modal: null,
    openConnect: vi.fn(),
    openManage: vi.fn(),
    openRecovery: vi.fn(),
    retryLoad: vi.fn(),
    searchEmpty: false,
    searchQuery: "",
    setActiveTab: vi.fn(),
    setSearchQuery: vi.fn(),
  });

  return {
    reset: () => baseState(),
    state: baseState(),
  };
});

function resetMutation() {
  return {
    cancelPendingConnection: vi.fn().mockResolvedValue(undefined),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock("@/hooks/mcp/use-connectors-catalog-state", () => ({
  useConnectorsCatalogState: () => connectorsCatalogState.state,
}));

vi.mock("@/hooks/mcp/use-connect-oauth-connector", () => ({
  useConnectOAuthConnector: () => resetMutation(),
}));

vi.mock("@/hooks/mcp/use-delete-connector", () => ({
  useDeleteConnector: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/mcp/use-install-connector", () => ({
  useInstallConnector: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/mcp/use-installed-connector-actions", () => ({
  useInstalledConnectorActions: () => ({
    isPending: () => false,
    onToggle: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/mcp/use-reconnect-oauth-connector", () => ({
  useReconnectOAuthConnector: () => resetMutation(),
}));

vi.mock("@/hooks/mcp/use-update-connector-secret", () => ({
  useUpdateConnectorSecret: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("./ConnectorCard", () => ({
  AvailableConnectorCard: ({ model }: { model: { entry: { id: string } } }) => createElement(
    "div",
    { "data-testid": "available-card" },
    model.entry.id,
  ),
  ConnectedConnectorCard: ({
    model,
  }: {
    model: { record: { metadata: { connectionId: string } } };
  }) => createElement(
    "div",
    { "data-testid": "connected-card" },
    model.record.metadata.connectionId,
  ),
}));

vi.mock("./ConnectorDetailModal", () => ({
  ConnectorDetailModal: () => null,
}));

vi.mock("./DeleteConnectorDialog", () => ({
  DeleteConnectorDialog: () => null,
}));

describe("ConnectorCatalogPage", () => {
  beforeEach(() => {
    connectorsCatalogState.state = connectorsCatalogState.reset();
  });

  it("renders a loading state instead of claiming everything is connected", () => {
    connectorsCatalogState.state.isLoading = true;

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("Loading integrations");
    expect(html).not.toContain("All available integrations are connected.");
  });

  it("renders an error state when connector data fails to load", () => {
    connectorsCatalogState.state.loadError = "Auth session expired";

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("Couldn&#x27;t load integrations");
    expect(html).toContain("Auth session expired");
  });

  it("renders an explicit empty catalog message when nothing is available", () => {
    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("No integrations are available right now.");
  });

  it("renders the connected-empty message only after at least one connector is connected", () => {
    connectorsCatalogState.state.connected = [
      {
        record: {
          metadata: { connectionId: "conn-1" },
        },
      },
    ] as never[];

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("All available integrations are connected.");
    expect(html).not.toContain("No integrations are available right now.");
  });
});
