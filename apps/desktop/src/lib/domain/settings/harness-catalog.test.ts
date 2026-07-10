import type { AgentLaunchOptionsResponse, GatewayModelEntry } from "@anyharness/sdk";
import type { AgentAuthSelection } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeCatalogModelsJson,
  catalogRouteForSurface,
  defaultRouteForSurface,
  normalizeCatalogModels,
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
  function gatewayModel(overrides: Partial<GatewayModelEntry> & { id: string }): GatewayModelEntry {
    return overrides;
  }

  it("joins the runtime's enriched catalog fields and marks every row enabled", () => {
    expect(
      normalizeGatewayModels([
        gatewayModel({
          id: "claude-sonnet-4-5",
          displayName: "Sonnet 4.6",
          description: "Balanced coding model",
          provider: "anthropic",
          status: "active",
          effort: { values: ["low", "medium", "high"], default: "medium" },
          fastMode: true,
          modes: ["default", "acceptEdits", "plan"],
        }),
      ]),
    ).toEqual([
      {
        id: "claude-sonnet-4-5",
        displayName: "Sonnet 4.6",
        description: "Balanced coding model",
        provider: "anthropic",
        status: "active",
        effort: { values: ["low", "medium", "high"], default: "medium" },
        fastMode: true,
        modes: ["default", "acceptEdits", "plan"],
        enabled: true,
      },
    ]);
  });

  it("renders probe-only ids sparse (id-only, no display metadata)", () => {
    expect(
      normalizeGatewayModels([gatewayModel({ id: "gpt-5.5", provider: "openai" })]),
    ).toEqual([
      {
        id: "gpt-5.5",
        displayName: "gpt-5.5",
        description: null,
        provider: "openai",
        status: null,
        effort: null,
        fastMode: null,
        modes: null,
        enabled: true,
      },
    ]);
  });

  it("drops empty ids and returns an empty list for no models", () => {
    expect(
      normalizeGatewayModels([gatewayModel({ id: "" }), gatewayModel({ id: "grok-5" })]),
    ).toEqual([
      {
        id: "grok-5",
        displayName: "grok-5",
        description: null,
        provider: null,
        status: null,
        effort: null,
        fastMode: null,
        modes: null,
        enabled: true,
      },
    ]);
    expect(normalizeGatewayModels([])).toEqual([]);
  });
});

describe("normalizeCatalogModels", () => {
  it("parses enriched cloud-snapshot rows and honors the enabled override", () => {
    expect(
      normalizeCatalogModels([
        {
          id: "sonnet",
          displayName: "Sonnet 4.6",
          description: "Balanced coding model",
          provider: "anthropic",
          status: "active",
          effort: { values: ["low", "high"], default: "high" },
          fastMode: false,
          modes: ["default", "plan"],
        },
        { id: "haiku", displayName: "Haiku 4.5", enabled: false },
      ]),
    ).toEqual([
      {
        id: "sonnet",
        displayName: "Sonnet 4.6",
        description: "Balanced coding model",
        provider: "anthropic",
        status: "active",
        effort: { values: ["low", "high"], default: "high" },
        fastMode: false,
        modes: ["default", "plan"],
        enabled: true,
      },
      {
        id: "haiku",
        displayName: "Haiku 4.5",
        description: null,
        provider: null,
        status: null,
        effort: null,
        fastMode: null,
        modes: null,
        enabled: false,
      },
    ]);
  });

  it("renders old thin snapshots (id-only) as sparse rows", () => {
    expect(normalizeCatalogModels([{ id: "legacy" }, { notAnId: true }])).toEqual([
      {
        id: "legacy",
        displayName: "legacy",
        description: null,
        provider: null,
        status: null,
        effort: null,
        fastMode: null,
        modes: null,
        enabled: true,
      },
    ]);
  });
});

describe("buildRuntimeCatalogModelsJson", () => {
  function launchOptions(
    agents: AgentLaunchOptionsResponse["agents"],
  ): AgentLaunchOptionsResponse {
    return { agents, workspaceId: null };
  }

  it("serializes the runtime's resolved models for the requested harness", () => {
    const result = buildRuntimeCatalogModelsJson(
      "claude",
      launchOptions([
        {
          kind: "claude",
          displayName: "Claude Code",
          defaultModelId: "sonnet",
          models: [
            { id: "sonnet", displayName: "Sonnet 4.6", isDefault: true },
            { id: "haiku", displayName: "Haiku 4.5", aliases: ["haiku-latest"], isDefault: false },
          ],
        },
      ]),
    );

    expect(result).toBe(
      JSON.stringify([
        { id: "sonnet", displayName: "Sonnet 4.6" },
        { id: "haiku", displayName: "Haiku 4.5", aliases: ["haiku-latest"] },
      ]),
    );
  });

  it("forwards the runtime-enriched catalog fields into the snapshot payload", () => {
    const result = buildRuntimeCatalogModelsJson(
      "claude",
      launchOptions([
        {
          kind: "claude",
          displayName: "Claude Code",
          defaultModelId: "sonnet",
          models: [
            {
              id: "sonnet",
              displayName: "Sonnet 4.6",
              isDefault: true,
              description: "Balanced coding model",
              provider: "anthropic",
              status: "active",
              effort: { values: ["low", "medium", "high"], default: "medium" },
              fastMode: true,
              modes: ["default", "acceptEdits", "plan"],
            },
          ],
        },
      ]),
    );

    expect(result).toBe(
      JSON.stringify([
        {
          id: "sonnet",
          displayName: "Sonnet 4.6",
          description: "Balanced coding model",
          provider: "anthropic",
          status: "active",
          effort: { values: ["low", "medium", "high"], default: "medium" },
          fastMode: true,
          modes: ["default", "acceptEdits", "plan"],
        },
      ]),
    );
  });

  it("returns null when the runtime has no entry for the harness", () => {
    const result = buildRuntimeCatalogModelsJson(
      "codex",
      launchOptions([
        {
          kind: "claude",
          displayName: "Claude Code",
          defaultModelId: null,
          models: [{ id: "sonnet", displayName: "Sonnet 4.6", isDefault: true }],
        },
      ]),
    );

    expect(result).toBeNull();
  });

  it("returns null when the harness has zero ready models", () => {
    const result = buildRuntimeCatalogModelsJson(
      "claude",
      launchOptions([
        { kind: "claude", displayName: "Claude Code", defaultModelId: null, models: [] },
      ]),
    );

    expect(result).toBeNull();
  });

  it("returns null when the runtime data is unavailable", () => {
    expect(buildRuntimeCatalogModelsJson("claude", undefined)).toBeNull();
  });
});
