import { describe, expect, it } from "vitest";
import type { IntegrationHealthItem } from "@proliferate/cloud-sdk/client/integrations";
import {
  integrationReauthChipLabel,
  integrationsNeedingReauth,
} from "./integration-reauth";

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

describe("integrationsNeedingReauth", () => {
  it("returns only connected items whose health is needs_reauth", () => {
    const reauth = makeHealthItem({
      definitionId: "def-2",
      displayName: "Notion",
      health: "needs_reauth",
    });
    const result = integrationsNeedingReauth([
      makeHealthItem(), // ready
      reauth,
      makeHealthItem({ definitionId: "def-3", health: "needs_auth", accountId: null }),
      makeHealthItem({ definitionId: "def-4", health: "error" }),
      makeHealthItem({ definitionId: "def-5", health: "disabled_by_user" }),
    ]);

    expect(result).toEqual([reauth]);
  });

  it("ignores needs_reauth rows without an account (nothing to repair)", () => {
    expect(
      integrationsNeedingReauth([
        makeHealthItem({ health: "needs_reauth", accountId: null }),
      ]),
    ).toEqual([]);
  });

  it("returns an empty list for an empty input", () => {
    expect(integrationsNeedingReauth([])).toEqual([]);
  });
});

describe("integrationReauthChipLabel", () => {
  it("is null when no providers need reauth", () => {
    expect(integrationReauthChipLabel([])).toBeNull();
  });

  it("names the provider when exactly one needs reauth", () => {
    expect(integrationReauthChipLabel(["Linear"])).toBe(
      "Linear needs re-authentication",
    );
  });

  it("collapses to a count when several need reauth", () => {
    expect(integrationReauthChipLabel(["Linear", "Notion", "Slack"])).toBe(
      "3 integrations need re-authentication",
    );
  });
});
