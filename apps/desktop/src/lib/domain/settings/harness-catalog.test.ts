import type { AgentAuthSelection } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import {
  catalogRouteForSurface,
  defaultRouteForSurface,
  normalizeGatewayModels,
} from "./harness-catalog";

function selection(
  overrides: Partial<AgentAuthSelection> = {},
): AgentAuthSelection {
  return {
    id: "sel-1",
    harnessKind: "claude",
    surface: "local",
    sourceKind: "api_key",
    apiKeyId: "key-1",
    keyTitle: "Work key",
    envVarName: "ANTHROPIC_API_KEY",
    providerHint: "anthropic",
    enabled: true,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AgentAuthSelection;
}

describe("defaultRouteForSurface", () => {
  it("defaults local to native and cloud to gateway", () => {
    expect(defaultRouteForSurface("local")).toBe("native");
    expect(defaultRouteForSurface("cloud")).toBe("gateway");
  });
});

describe("catalogRouteForSurface", () => {
  it("prefers the gateway route when an enabled gateway source exists", () => {
    const route = catalogRouteForSurface("opencode", "local", [
      selection({
        harnessKind: "opencode",
        sourceKind: "gateway",
        apiKeyId: null,
        envVarName: null,
      }),
      selection({ id: "sel-2", harnessKind: "opencode" }),
    ]);
    expect(route).toBe("gateway");
  });

  it("uses the api_key route when only an enabled api_key source exists", () => {
    expect(catalogRouteForSurface("claude", "local", [selection()])).toBe("api_key");
  });

  it("ignores disabled sources and falls back to the surface default", () => {
    expect(
      catalogRouteForSurface("claude", "local", [selection({ enabled: false })]),
    ).toBe("native");
    expect(catalogRouteForSurface("claude", "cloud", [])).toBe("gateway");
  });

  it("scopes to the requested harness and surface", () => {
    const route = catalogRouteForSurface("claude", "local", [
      selection({ id: "other-surface", surface: "cloud", sourceKind: "gateway", apiKeyId: null, envVarName: null }),
      selection({ id: "other-harness", harnessKind: "codex", sourceKind: "gateway", apiKeyId: null, envVarName: null }),
    ]);
    expect(route).toBe("native");
  });
});

describe("normalizeGatewayModels", () => {
  it("treats every runtime-resolved model id as enabled with no display metadata", () => {
    expect(normalizeGatewayModels(["claude-sonnet-4-5", "claude-haiku-4-5"])).toEqual([
      {
        id: "claude-sonnet-4-5",
        displayName: "claude-sonnet-4-5",
        description: null,
        provider: null,
        enabled: true,
      },
      {
        id: "claude-haiku-4-5",
        displayName: "claude-haiku-4-5",
        description: null,
        provider: null,
        enabled: true,
      },
    ]);
  });

  it("drops empty ids and returns an empty list for no models", () => {
    expect(normalizeGatewayModels(["", "gpt-5.5"])).toEqual([
      {
        id: "gpt-5.5",
        displayName: "gpt-5.5",
        description: null,
        provider: null,
        enabled: true,
      },
    ]);
    expect(normalizeGatewayModels([])).toEqual([]);
  });
});
