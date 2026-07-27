import type { AgentLaunchOptionsResponse } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  normalizeCatalogModels,
  normalizeRuntimeLaunchModels,
} from "#product/lib/domain/settings/harness-catalog";

// The route/auth-context helper suites (`defaultRouteForSurface`,
// `catalogRouteForSurface`) are deleted with the composed cloud re-key: the
// layered read is keyed by (owner, harness) alone, so no route resolution
// remains to test.

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

describe("normalizeRuntimeLaunchModels", () => {
  it("reads enriched models for the requested harness from the local runtime", () => {
    const launchOptions: AgentLaunchOptionsResponse = {
      agents: [
        {
          kind: "codex",
          displayName: "Codex",
          defaultModelId: "gpt-5.5",
          models: [
            {
              id: "gpt-5.5",
              displayName: "GPT 5.5",
              isDefault: true,
              description: "Latest coding model",
              provider: "openai",
              status: "active",
              effort: { values: ["low", "medium", "high"], default: "medium" },
              fastMode: true,
              modes: ["default", "plan"],
            },
          ],
        },
      ],
    };

    expect(normalizeRuntimeLaunchModels("codex", launchOptions)).toEqual([
      {
        id: "gpt-5.5",
        displayName: "GPT 5.5",
        description: "Latest coding model",
        provider: "openai",
        status: "active",
        effort: { values: ["low", "medium", "high"], default: "medium" },
        fastMode: true,
        modes: ["default", "plan"],
        enabled: true,
      },
    ]);
  });

  it("does not leak another harness's runtime models", () => {
    const launchOptions: AgentLaunchOptionsResponse = {
      agents: [{
        kind: "claude",
        displayName: "Claude Code",
        defaultModelId: "sonnet",
        models: [{ id: "sonnet", displayName: "Sonnet", isDefault: true }],
      }],
    };

    expect(normalizeRuntimeLaunchModels("codex", launchOptions)).toEqual([]);
  });
});
