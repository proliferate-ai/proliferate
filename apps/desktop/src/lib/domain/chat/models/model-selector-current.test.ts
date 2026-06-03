import { describe, expect, it } from "vitest";
import { resolveCurrentModelDisplayName } from "./model-selector-current";

describe("resolveCurrentModelDisplayName", () => {
  it("uses catalog labels for config-shaped live model ids", () => {
    expect(resolveCurrentModelDisplayName({
      activeLaunchIdentity: {
        kind: "cursor",
        modelId: "composer-2.5[fast=true]",
      },
      defaultLaunchSelection: null,
      launchAgents: [{
        kind: "cursor",
        models: [{
          id: "composer-2.5-fast",
          displayName: "Composer 2.5 Fast",
          aliases: ["composer-2[fast=true]"],
        }],
      }],
      liveConfigLabel: "composer-2.5",
    })).toBe("Composer 2.5 Fast");
  });

  it("uses the catalog label for Gemini preview runtime ids", () => {
    expect(resolveCurrentModelDisplayName({
      activeLaunchIdentity: {
        kind: "gemini",
        modelId: "gemini-3-flash-preview",
      },
      defaultLaunchSelection: null,
      launchAgents: [{
        kind: "gemini",
        models: [{
          id: "gemini-3-flash",
          displayName: "Gemini 3 Flash",
          aliases: [],
        }],
      }],
      liveConfigLabel: null,
    })).toBe("Gemini 3 Flash");
  });
});
