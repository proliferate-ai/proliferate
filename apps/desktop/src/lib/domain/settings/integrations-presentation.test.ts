import { describe, expect, it } from "vitest";
import {
  filterIntegrationsByQuery,
  INTEGRATIONS_SEARCH_THRESHOLD,
  integrationAuthKindLabel,
  integrationHealthBadge,
  integrationMatchesQuery,
  integrationOauthReturnToast,
  integrationRowActions,
  integrationSearchState,
  integrationToolCountLabel,
} from "@/lib/domain/settings/integrations-presentation";

describe("integrationHealthBadge", () => {
  it("maps every health verdict to a labelled badge", () => {
    expect(integrationHealthBadge("ready")).toEqual({ label: "Ready", tone: "success" });
    expect(integrationHealthBadge("needs_auth")).toEqual({ label: "Not connected", tone: "neutral" });
    expect(integrationHealthBadge("needs_reauth")).toEqual({ label: "Reconnect required", tone: "warning" });
    expect(integrationHealthBadge("disabled_by_user")).toEqual({ label: "Disabled", tone: "neutral" });
    expect(integrationHealthBadge("disabled_by_org")).toEqual({ label: "Disabled by org", tone: "neutral" });
    expect(integrationHealthBadge("error")).toEqual({ label: "Error", tone: "destructive" });
  });
});

describe("integrationAuthKindLabel", () => {
  it("labels each auth kind", () => {
    expect(integrationAuthKindLabel("oauth2")).toBe("OAuth");
    expect(integrationAuthKindLabel("api_key")).toBe("API key");
    expect(integrationAuthKindLabel("none")).toBe("No auth");
  });
});

describe("integrationToolCountLabel", () => {
  it("pluralizes tool counts and hides unprobed integrations", () => {
    expect(integrationToolCountLabel(null)).toBeNull();
    expect(integrationToolCountLabel(0)).toBe("0 tools");
    expect(integrationToolCountLabel(1)).toBe("1 tool");
    expect(integrationToolCountLabel(12)).toBe("12 tools");
  });
});

describe("integrationRowActions", () => {
  it("offers connect for unconnected integrations", () => {
    expect(integrationRowActions({ accountId: null, health: "needs_auth" })).toEqual({
      connect: true,
      reconnect: false,
      disconnect: false,
    });
  });

  it("offers only disconnect for healthy connected integrations", () => {
    expect(integrationRowActions({ accountId: "acc-1", health: "ready" })).toEqual({
      connect: false,
      reconnect: false,
      disconnect: true,
    });
  });

  it("offers reconnect when an account needs reauth or errored", () => {
    expect(integrationRowActions({ accountId: "acc-1", health: "needs_reauth" })).toEqual({
      connect: false,
      reconnect: true,
      disconnect: true,
    });
    expect(integrationRowActions({ accountId: "acc-1", health: "error" })).toEqual({
      connect: false,
      reconnect: true,
      disconnect: true,
    });
  });

  it("blocks connecting org-disabled integrations but allows account cleanup", () => {
    expect(integrationRowActions({ accountId: null, health: "disabled_by_org" })).toEqual({
      connect: false,
      reconnect: false,
      disconnect: false,
    });
    expect(integrationRowActions({ accountId: "acc-1", health: "disabled_by_org" })).toEqual({
      connect: false,
      reconnect: false,
      disconnect: true,
    });
  });
});

describe("integrationMatchesQuery", () => {
  const linear = { displayName: "Linear", namespace: "linear" };

  it("matches on display name, case-insensitively", () => {
    expect(integrationMatchesQuery(linear, "lin")).toBe(true);
    expect(integrationMatchesQuery(linear, "LIN")).toBe(true);
  });

  it("matches on namespace", () => {
    expect(integrationMatchesQuery({ displayName: "Custom Tool", namespace: "acme-crm" }, "acme")).toBe(true);
  });

  it("rejects non-matching queries", () => {
    expect(integrationMatchesQuery(linear, "slack")).toBe(false);
  });

  it("treats an empty or whitespace query as matching everything", () => {
    expect(integrationMatchesQuery(linear, "")).toBe(true);
    expect(integrationMatchesQuery(linear, "   ")).toBe(true);
  });
});

describe("filterIntegrationsByQuery", () => {
  const items = [
    { displayName: "Linear", namespace: "linear" },
    { displayName: "Slack", namespace: "slack" },
    { displayName: "Acme CRM", namespace: "acme-crm" },
  ];

  it("narrows the list to matches", () => {
    expect(filterIntegrationsByQuery(items, "crm")).toEqual([
      { displayName: "Acme CRM", namespace: "acme-crm" },
    ]);
  });

  it("returns everything for an empty query", () => {
    expect(filterIntegrationsByQuery(items, "")).toEqual(items);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterIntegrationsByQuery(items, "notfound")).toEqual([]);
  });
});

describe("integrationSearchState", () => {
  it("hides the input and keeps the raw query while the list is short", () => {
    expect(integrationSearchState(INTEGRATIONS_SEARCH_THRESHOLD, "")).toEqual({
      showSearch: false,
      activeQuery: "",
    });
  });

  it("shows the input and filters by the query once the list is long", () => {
    expect(integrationSearchState(INTEGRATIONS_SEARCH_THRESHOLD + 1, "linear")).toEqual({
      showSearch: true,
      activeQuery: "linear",
    });
  });

  it("resets the effective query when a filtered list shrinks below the threshold", () => {
    // The bar was visible with a query set; the list then shrinks so the input
    // hides. The effective query must drop to empty so the shrunk list is not
    // filtered behind a gone input (the phantom "No integrations found" bug).
    const shrunk = integrationSearchState(2, "no-match-xyz");
    expect(shrunk.showSearch).toBe(false);
    expect(shrunk.activeQuery).toBe("");
  });
});

describe("integrationOauthReturnToast", () => {
  it("announces completion as an info toast", () => {
    expect(integrationOauthReturnToast("completed")).toEqual({
      message: "Integration connected.",
      type: "info",
    });
  });

  it("announces failures with the failure code", () => {
    expect(integrationOauthReturnToast("failed", "access_denied")).toEqual({
      message: "Integration could not be connected (access_denied).",
      type: "error",
    });
    expect(integrationOauthReturnToast("expired", null)).toEqual({
      message: "Integration authorization expired. Try connecting again.",
      type: "error",
    });
  });

  it("treats cancellation as informational", () => {
    expect(integrationOauthReturnToast("cancelled")).toEqual({
      message: "Integration authorization was cancelled.",
      type: "info",
    });
  });

  it("stays quiet for missing or non-terminal statuses", () => {
    expect(integrationOauthReturnToast(null)).toBeNull();
    expect(integrationOauthReturnToast(undefined)).toBeNull();
    expect(integrationOauthReturnToast("pending")).toBeNull();
  });
});
