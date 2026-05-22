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
    sharedExposure: {
      activeOrganizationId: "org_1",
      activeOrganizationName: "Acme",
      canManage: true,
      currentUserId: "user_1",
      hasOrganization: true,
      isLoading: false,
    },
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

vi.mock("@/hooks/mcp/ui/use-connectors-catalog-state", () => ({
  useConnectorsCatalogState: () => connectorsCatalogState.state,
}));

vi.mock("@/hooks/mcp/workflows/use-connect-oauth-connector", () => ({
  useConnectOAuthConnector: () => resetMutation(),
}));

vi.mock("@/hooks/mcp/workflows/use-delete-connector", () => ({
  useDeleteConnector: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/mcp/workflows/use-install-connector", () => ({
  useInstallConnector: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/mcp/workflows/use-installed-connector-actions", () => ({
  useInstalledConnectorActions: () => ({
    isPending: () => false,
    onToggle: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/mcp/workflows/use-reconnect-oauth-connector", () => ({
  useReconnectOAuthConnector: () => resetMutation(),
}));

vi.mock("@/hooks/mcp/workflows/use-update-connector-secret", () => ({
  useUpdateConnectorSecret: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("./PluginPackageRow", () => ({
  AvailablePluginPackageRow: ({ model }: { model: { entry: { id: string } } }) => createElement(
    "div",
    { "data-testid": "available-plugin-row" },
    model.entry.id,
  ),
  ConnectedPluginPackageRow: ({
    canManageSharedExposure,
    model,
  }: {
    canManageSharedExposure: boolean;
    model: { record: { metadata: { connectionId: string } } };
  }) => createElement(
    "div",
    { "data-testid": "connected-plugin-row" },
    `${model.record.metadata.connectionId}:${canManageSharedExposure ? "can-share" : "cannot-share"}`,
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

    expect(html).toContain("Loading plugins");
    expect(html).not.toContain("All available plugins are installed.");
  });

  it("renders an error state when connector data fails to load", () => {
    connectorsCatalogState.state.loadError = "Auth session expired";

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("Couldn&#x27;t load plugins");
    expect(html).toContain("Auth session expired");
  });

  it("renders an explicit empty catalog message when nothing is available", () => {
    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("No plugins are available right now.");
  });

  it("renders the connected-empty message only after at least one connector is connected", () => {
    connectorsCatalogState.state.connected = [
      {
        record: {
          metadata: { connectionId: "conn-1", ownerScope: "personal", ownerUserId: "user_2" },
        },
      },
    ] as never[];

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("All available plugins are installed.");
    expect(html).not.toContain("No plugins are available right now.");
  });

  it("lets personal source owners publish their plugin package without being org admins", () => {
    connectorsCatalogState.state.sharedExposure.canManage = false;
    connectorsCatalogState.state.connected = [
      {
        record: {
          metadata: { connectionId: "conn-1", ownerScope: "personal", ownerUserId: "user_1" },
        },
      },
    ] as never[];

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("conn-1:can-share");
  });

  it("lets organization admins publish personal source plugin packages", () => {
    connectorsCatalogState.state.sharedExposure.canManage = true;
    connectorsCatalogState.state.connected = [
      {
        record: {
          metadata: { connectionId: "conn-1", ownerScope: "personal", ownerUserId: "user_2" },
        },
      },
    ] as never[];

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("conn-1:can-share");
  });

  it("blocks shared exposure actions for non-admins who do not own the personal source", () => {
    connectorsCatalogState.state.sharedExposure.canManage = false;
    connectorsCatalogState.state.connected = [
      {
        record: {
          metadata: { connectionId: "conn-1", ownerScope: "personal", ownerUserId: "user_2" },
        },
      },
    ] as never[];

    const html = renderToStaticMarkup(createElement(ConnectorCatalogPage));

    expect(html).toContain("conn-1:cannot-share");
  });
});
