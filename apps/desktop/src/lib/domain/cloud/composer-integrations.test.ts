import { describe, expect, it } from "vitest";
import type { IntegrationHealthItem } from "@proliferate/cloud-sdk/client/integrations";
import {
  composerIntegrationHealthDot,
  deriveComposerIntegrationsModel,
} from "./composer-integrations";

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

describe("deriveComposerIntegrationsModel", () => {
  it("hides the control when nothing is connected", () => {
    const model = deriveComposerIntegrationsModel([
      makeHealthItem({ accountId: null, health: "needs_auth" }),
    ]);

    expect(model.mode).toBe("hidden");
    expect(model.connectedCount).toBe(0);
    expect(model.providers).toEqual([]);
    expect(model.reauthLabel).toBeNull();
  });

  it("is quiet when every connected provider is healthy", () => {
    const model = deriveComposerIntegrationsModel([
      makeHealthItem(),
      makeHealthItem({ definitionId: "def-2", namespace: "notion", displayName: "Notion" }),
      // Never-connected catalog rows do not count toward the connected total.
      makeHealthItem({ definitionId: "def-3", accountId: null, health: "needs_auth" }),
    ]);

    expect(model.mode).toBe("quiet");
    expect(model.connectedCount).toBe(2);
    expect(model.reauthLabel).toBeNull();
    expect(model.providers.map((provider) => provider.displayName)).toEqual([
      "Linear",
      "Notion",
    ]);
    expect(model.providers.every((provider) => provider.needsReauth === false)).toBe(true);
  });

  it("escalates to urgent and names a single provider needing reauth", () => {
    const model = deriveComposerIntegrationsModel([
      makeHealthItem(),
      makeHealthItem({
        definitionId: "def-2",
        namespace: "notion",
        displayName: "Notion",
        health: "needs_reauth",
      }),
    ]);

    expect(model.mode).toBe("urgent");
    expect(model.connectedCount).toBe(2);
    expect(model.reauthLabel).toBe("Notion needs re-authentication");
    // Reauth-needing providers sort to the top of the popover list.
    expect(model.providers[0]).toMatchObject({ displayName: "Notion", needsReauth: true });
  });

  it("collapses several reauth providers into a count label", () => {
    const model = deriveComposerIntegrationsModel([
      makeHealthItem({ health: "needs_reauth" }),
      makeHealthItem({
        definitionId: "def-2",
        namespace: "notion",
        displayName: "Notion",
        health: "needs_reauth",
      }),
    ]);

    expect(model.mode).toBe("urgent");
    expect(model.reauthLabel).toBe("2 integrations need re-authentication");
  });

  it("does not treat a disconnected needs_reauth row as connected", () => {
    const model = deriveComposerIntegrationsModel([
      makeHealthItem({ accountId: null, health: "needs_reauth" }),
    ]);

    expect(model.mode).toBe("hidden");
    expect(model.reauthLabel).toBeNull();
  });
});

describe("composerIntegrationHealthDot", () => {
  it("maps ready to a success dot", () => {
    expect(composerIntegrationHealthDot("ready")).toEqual({
      className: "bg-success",
      label: "Connected",
    });
  });

  it("maps needs_reauth to a warning dot", () => {
    expect(composerIntegrationHealthDot("needs_reauth").className).toBe("bg-warning");
  });

  it("maps error to a destructive dot", () => {
    expect(composerIntegrationHealthDot("error").className).toBe("bg-destructive");
  });
});
