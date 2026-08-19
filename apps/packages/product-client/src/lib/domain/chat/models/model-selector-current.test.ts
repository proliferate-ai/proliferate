import { describe, expect, it } from "vitest";
import { resolveCurrentModelDisplayName } from "#product/lib/domain/chat/models/model-selector-current";

describe("resolveCurrentModelDisplayName", () => {
  it("does not alias a config-shaped live model id onto a different launch row", () => {
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
    })).toBe("composer-2.5");
  });
});
