import { describe, expect, it } from "vitest";
import type {
  DesktopAgentLaunchAgent,
  DesktopLaunchModelRegistry,
} from "@/lib/domain/agents/cloud-launch-catalog";
import {
  filterVisibleLaunchModels,
  filterVisibleRegistryModels,
  resolveVisibleRegistryModelIds,
  withUpdatedModelVisibilityOverride,
} from "./model-visibility";

describe("withUpdatedModelVisibilityOverride", () => {
  it("stores an override when the choice differs from the catalog default", () => {
    expect(
      withUpdatedModelVisibilityOverride({}, "cursor", "cursor/gpt-5.4", false, true),
    ).toEqual({
      cursor: {
        "cursor/gpt-5.4": false,
      },
    });
  });

  it("removes an override when the choice returns to the catalog default", () => {
    expect(
      withUpdatedModelVisibilityOverride(
        {
          cursor: {
            "cursor/gpt-5.4": false,
          },
        },
        "cursor",
        "cursor/gpt-5.4",
        true,
        true,
      ),
    ).toEqual({});
  });
});

describe("visible model filters", () => {
  it("keeps the catalog/default model visible when all dynamic rows default hidden", () => {
    const registry: DesktopLaunchModelRegistry = {
      kind: "cursor",
      displayName: "Cursor",
      defaultModelId: "auto",
      models: [
        {
          id: "auto",
          displayName: "Auto",
          isDefault: true,
          defaultOptIn: false,
        },
        {
          id: "new-model",
          displayName: "New Model",
          isDefault: false,
          defaultOptIn: false,
        },
      ],
    };

    expect([...resolveVisibleRegistryModelIds({ registry, overrides: {} })]).toEqual(["auto"]);
    expect(filterVisibleRegistryModels({ registry, overrides: {} }).map((model) => model.id))
      .toEqual(["auto"]);
  });

  it("preserves a selected launch model even when the user hides it", () => {
    const agent: DesktopAgentLaunchAgent = {
      kind: "opencode",
      displayName: "OpenCode",
      defaultModelId: "openai/gpt-5.5",
      dynamicModels: true,
      models: [
        {
          id: "openai/gpt-5.5",
          displayName: "GPT 5.5",
          aliases: [],
          status: "active",
          isDefault: true,
          defaultOptIn: true,
          provider: "openai",
          tags: [],
        },
      ],
      launchControls: [],
    };

    expect(filterVisibleLaunchModels({
      agent,
      selectedModelId: "openai/gpt-5.5",
      overrides: {
        opencode: {
          "openai/gpt-5.5": false,
        },
      },
    }).map((model) => model.id)).toEqual(["openai/gpt-5.5"]);
  });
});
