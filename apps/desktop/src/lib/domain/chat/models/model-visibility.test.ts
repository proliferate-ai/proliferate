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
  it("defaults every catalog menu model to visible and falls back when all are hidden", () => {
    const registry: DesktopLaunchModelRegistry = {
      kind: "cursor",
      displayName: "Cursor",
      defaultModelId: "auto",
      models: [
        {
          id: "auto",
          displayName: "Auto",
          isDefault: true,
        },
        {
          id: "new-model",
          displayName: "New Model",
          isDefault: false,
        },
      ],
    };

    expect([...resolveVisibleRegistryModelIds({ registry, overrides: {} })])
      .toEqual(["auto", "new-model"]);

    const allHidden = {
      cursor: {
        auto: false,
        "new-model": false,
      },
    };
    expect([...resolveVisibleRegistryModelIds({ registry, overrides: allHidden })])
      .toEqual(["auto"]);
    expect(filterVisibleRegistryModels({ registry, overrides: allHidden }).map((model) => model.id))
      .toEqual(["auto"]);
  });

  it("preserves a selected launch model even when the user hides it", () => {
    const agent: DesktopAgentLaunchAgent = {
      kind: "opencode",
      displayName: "OpenCode",
      defaultModelId: "openai/gpt-5.5",
      models: [
        {
          id: "openai/gpt-5.5",
          displayName: "GPT 5.5",
          aliases: [],
          status: "active",
          isDefault: true,
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
