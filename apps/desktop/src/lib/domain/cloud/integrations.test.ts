import { describe, expect, it } from "vitest";
import type {
  IntegrationCatalogItem,
  IntegrationHealthItem,
} from "@proliferate/cloud-sdk/client/integrations";
import {
  isTerminalIntegrationOauthFlowStatus,
  mergeCloudIntegrations,
} from "./integrations";

function catalogItem(overrides: Partial<IntegrationCatalogItem> = {}): IntegrationCatalogItem {
  return {
    definitionId: "def-1",
    namespace: "context7",
    displayName: "Context7",
    description: "Docs lookup.",
    authKind: "api_key",
    connectSchema: {
      secretFields: [
        {
          id: "api_key",
          label: "API key",
          placeholder: "ctx7sk-...",
          helperText: "Create a key.",
          prefixHint: "ctx7sk-",
        },
      ],
      settingsFields: [],
    },
    ...overrides,
  };
}

function healthItem(overrides: Partial<IntegrationHealthItem> = {}): IntegrationHealthItem {
  return {
    definitionId: "def-1",
    accountId: "acc-1",
    namespace: "context7",
    displayName: "Context7",
    authKind: "api_key",
    effectiveEnabled: true,
    policyEnabled: null,
    accountEnabled: true,
    health: "ready",
    tokenExpiresAt: null,
    toolCount: 4,
    lastErrorCode: null,
    ...overrides,
  };
}

describe("mergeCloudIntegrations", () => {
  it("merges catalog and health rows by definitionId", () => {
    const views = mergeCloudIntegrations([catalogItem()], [healthItem()]);
    expect(views).toHaveLength(1);
    const view = views[0]!;
    expect(view.definitionId).toBe("def-1");
    expect(view.displayName).toBe("Context7");
    expect(view.description).toBe("Docs lookup.");
    expect(view.connectSchema.secretFields[0]?.id).toBe("api_key");
    expect(view.health).toBe("ready");
    expect(view.accountId).toBe("acc-1");
    expect(view.toolCount).toBe(4);
  });

  it("defaults catalog-only rows to needs_auth with no account", () => {
    const views = mergeCloudIntegrations([catalogItem()], []);
    expect(views).toHaveLength(1);
    expect(views[0]!.health).toBe("needs_auth");
    expect(views[0]!.accountId).toBeNull();
    expect(views[0]!.effectiveEnabled).toBe(true);
  });

  it("keeps health-only rows with an empty connect schema", () => {
    const views = mergeCloudIntegrations(
      [],
      [healthItem({ definitionId: "def-2", namespace: "linear", displayName: "Linear" })],
    );
    expect(views).toHaveLength(1);
    const view = views[0]!;
    expect(view.definitionId).toBe("def-2");
    expect(view.displayName).toBe("Linear");
    expect(view.description).toBeNull();
    expect(view.connectSchema).toEqual({ secretFields: [], settingsFields: [] });
    expect(view.health).toBe("ready");
  });

  it("preserves catalog order and appends health-only rows", () => {
    const views = mergeCloudIntegrations(
      [
        catalogItem({ definitionId: "def-a", namespace: "a" }),
        catalogItem({ definitionId: "def-b", namespace: "b" }),
      ],
      [
        healthItem({ definitionId: "def-b", namespace: "b" }),
        healthItem({ definitionId: "def-z", namespace: "z" }),
      ],
    );
    expect(views.map((view) => view.definitionId)).toEqual(["def-a", "def-b", "def-z"]);
  });

  it("does not duplicate rows shared by both sources", () => {
    const views = mergeCloudIntegrations([catalogItem()], [healthItem()]);
    expect(views.filter((view) => view.definitionId === "def-1")).toHaveLength(1);
  });
});

describe("isTerminalIntegrationOauthFlowStatus", () => {
  it("treats completed/failed/cancelled/expired as terminal", () => {
    for (const status of ["completed", "failed", "cancelled", "expired"]) {
      expect(isTerminalIntegrationOauthFlowStatus(status)).toBe(true);
    }
  });

  it("keeps polling for active and exchanging flows", () => {
    expect(isTerminalIntegrationOauthFlowStatus("active")).toBe(false);
    expect(isTerminalIntegrationOauthFlowStatus("exchanging")).toBe(false);
  });
});
