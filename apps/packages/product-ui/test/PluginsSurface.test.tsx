// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginInventoryItem } from "@proliferate/product-domain/plugins/cloud-plugin-inventory";

import { PluginsSurface } from "../src/plugins/PluginsSurface";
import type { PluginsSurfaceProps } from "../src/plugins/PluginsSurface";

describe("PluginsSurface", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens available integrations in connect mode", () => {
    const item = pluginItem({ state: "available" });
    const onOpenItem = vi.fn();

    renderSurface({ items: [item], onOpenItem });

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(onOpenItem).toHaveBeenCalledWith(item, "connect");
  });

  it("requests disconnect for installed integrations", () => {
    const item = pluginItem({ state: "installed" });
    const onRequestDelete = vi.fn();

    renderSurface({ items: [item], onRequestDelete });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(onRequestDelete).toHaveBeenCalledWith(item);
  });
});

function renderSurface(overrides: Partial<PluginsSurfaceProps> = {}) {
  const props: PluginsSurfaceProps = {
    items: [],
    query: "",
    loading: false,
    error: null,
    surface: "desktop",
    selectedItem: null,
    modalMode: "connect",
    draft: null,
    submitting: false,
    pendingItemIds: [],
    modalError: null,
    completionNotice: null,
    canShare: false,
    canCancelSubmission: false,
    cancelingSubmission: false,
    shareOrganizationName: null,
    deleteTarget: null,
    deletePending: false,
    onQueryChange: vi.fn(),
    onRetry: vi.fn(),
    onOpenItem: vi.fn(),
    onCloseItem: vi.fn(),
    onCancelSubmission: vi.fn(),
    onDraftSettingsChange: vi.fn(),
    onDraftSecretChange: vi.fn(),
    onSubmitSelected: vi.fn(),
    onToggleEnabled: vi.fn(),
    onShareChange: vi.fn(),
    onOpenDocs: vi.fn(),
    onOpenDesktop: vi.fn(),
    onRequestDelete: vi.fn(),
    onCloseDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    ...overrides,
  };

  render(<PluginsSurface {...props} />);
}

function pluginItem({
  state,
}: {
  state: PluginInventoryItem["state"];
}): PluginInventoryItem {
  return {
    id: state === "installed" ? "conn_granola" : "granola",
    state,
    entry: {
      id: "granola",
      version: 1,
      name: "Granola",
      oneLiner: "Granola takes your raw meeting notes and makes them awesome.",
      description: "Granola tools.",
      docsUrl: "https://docs.example/granola",
      availability: "universal",
      cloudSecretSync: true,
      setupKind: "none",
      transport: "http",
      authKind: "oauth",
      url: "https://granola.example/mcp",
      displayUrl: "granola.example",
      serverNameBase: "granola",
      iconId: "granola",
      capabilities: [],
      secretFields: [],
      requiredFields: [],
      settingsSchema: [],
    },
    setupVariant: "oauth",
    configuredPlugin: null,
    configuredSkills: [],
    enabled: true,
    broken: false,
    statusLabel: state === "installed" ? "Connected" : "Available",
    statusTone: "neutral",
    statusActionLabel: null,
    unavailableReason: null,
    capabilitySummary: "MCP",
    includesLabel: "MCP",
    sharedLabel: "Private",
    sharedTone: "muted",
    isFullyPublic: false,
    hasPublicItems: false,
  };
}
