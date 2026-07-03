import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import {
  buildModelSelectorGroups,
} from "./model-selector-options";

function launchAgent(
  kind: string,
  models: DesktopAgentLaunchAgent["models"],
  overrides: Partial<DesktopAgentLaunchAgent> = {},
): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName: kind === "claude" ? "Claude" : "Codex",
    defaultModelId: models[0]?.id ?? null,
    models,
    launchControls: [],
    ...overrides,
  };
}

function model(
  id: string,
  displayName: string,
  isDefault: boolean,
  overrides: Partial<DesktopAgentLaunchAgent["models"][number]> = {},
) {
  return {
    id,
    displayName,
    aliases: [],
    status: "active" as const,
    isDefault,
    ...overrides,
  };
}

describe("buildModelSelectorGroups dynamic models", () => {
  it("applies visibility preferences to active model controls", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true),
            model("cursor/gpt-5.4", "GPT 5.4", false),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "cursor/auto" },
      { kind: "cursor", modelId: "cursor/auto" },
      {
        kind: "cursor",
        values: [
          { value: "cursor/auto", label: "Auto" },
          { value: "cursor/gpt-5.4", label: "GPT 5.4" },
        ],
      },
      {
        cursor: {
          "cursor/gpt-5.4": false,
        },
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "cursor/auto",
    ]);
  });

  it("applies visibility preferences to active model controls by alias", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
            }),
            model("cursor/gpt-5.4", "GPT 5.4", false, {
              aliases: ["gpt-5.4"],
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "auto" },
      { kind: "cursor", modelId: "auto" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
        ],
      },
      {
        cursor: {
          "cursor/gpt-5.4": false,
        },
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "auto",
    ]);
  });

  it("keeps canonical selected models visible when live controls use aliases", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
            }),
            model("cursor/gpt-5.4", "GPT 5.4", false, {
              aliases: ["gpt-5.4"],
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "cursor/gpt-5.4" },
      { kind: "cursor", modelId: "cursor/gpt-5.4" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
        ],
      },
      {
        cursor: {
          "cursor/gpt-5.4": false,
        },
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "cursor",
        modelId: "auto",
        displayName: "Auto",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "cursor",
        modelId: "gpt-5.4",
        displayName: "GPT 5.4",
        actionKind: "select",
        isSelected: true,
      },
    ]);
  });

  it("hides unknown live control models for dynamic agents unless selected", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "auto" },
      { kind: "cursor", modelId: "auto" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
          { value: "grok-4.3", label: "Grok 4.3" },
        ],
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "auto",
    ]);
  });

  it("keeps selected unknown live control models visible for dynamic agents", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "gpt-5.4" },
      { kind: "cursor", modelId: "gpt-5.4" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
          { value: "grok-4.3", label: "Grok 4.3" },
        ],
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "auto",
      "gpt-5.4",
    ]);
  });

  it("dedupes Cursor live control rows against catalog models with human labels", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("auto", "Auto", true),
            model("composer-2.5", "Composer 2.5", false, {
              aliases: ["composer-2"],
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "composer-2.5" },
      { kind: "cursor", modelId: "composer-2.5" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "composer-2.5", label: "composer-2.5" },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "cursor",
        modelId: "auto",
        displayName: "Auto",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "cursor",
        modelId: "composer-2.5",
        displayName: "Composer 2.5",
        actionKind: "select",
        isSelected: true,
      },
    ]);
  });

  it("canonicalizes Cursor config-shaped live model ids before display and dedupe", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("auto", "Auto", true, {
              aliases: ["default[]"],
            }),
            model("composer-2.5", "Composer 2.5", false),
            model("composer-2.5-fast", "Composer 2.5 Fast", false, {
              aliases: ["composer-2[fast=true]"],
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "composer-2.5[fast=true]" },
      { kind: "cursor", modelId: "composer-2.5[fast=true]" },
      {
        kind: "cursor",
        values: [
          { value: "default[]", label: "Auto" },
          { value: "composer-2.5[fast=true]", label: "composer-2.5" },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "cursor",
        modelId: "default[]",
        displayName: "Auto",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "cursor",
        modelId: "composer-2.5[fast=true]",
        displayName: "Composer 2.5 Fast",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "cursor",
        modelId: "composer-2.5",
        displayName: "Composer 2.5",
        actionKind: "update_current_chat",
        isSelected: false,
      },
    ]);
  });
});
