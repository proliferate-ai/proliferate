import { describe, expect, it } from "vitest";
import { projectHarnessLaunchOptions } from "#product/lib/domain/agents/cloud-launch-catalog";

function response(models: Array<{ id: string; observedName?: string | null }>) {
  return {
    harnessKind: "claude",
    options: {
      models: models.map((model) => ({
        id: model.id,
        observedName: model.observedName ?? null,
        observedDescription: null,
      })),
      controls: [],
      defaults: { modelId: models[0]?.id ?? null, controlValues: {} },
    },
  } as unknown as Parameters<typeof projectHarnessLaunchOptions>[0];
}

function displayNameFor(id: string, observedName: string | null): string | undefined {
  return projectHarnessLaunchOptions(response([{ id, observedName }]))
    ?.models.find((model) => model.id === id)?.displayName;
}

// One model must not carry two names. The composer's current-model label
// resolves the canonical product name on its own, so a catalog that passed the
// harness's short observed name straight through gave home and the picker rows
// "Fable" while the live composer said "Fable 5" for the very same session.
describe("projectHarnessLaunchOptions display names", () => {
  it("prints the canonical versioned name for a version-bearing id", () => {
    expect(displayNameFor("claude-fable-5", "Fable")).toBe("Fable 5");
  });

  it("prints the canonical versioned name for an aliased short id", () => {
    expect(displayNameFor("sonnet", "Sonnet")).toBe("Sonnet 4.6");
    expect(displayNameFor("haiku", "Haiku")).toBe("Haiku 4.5");
  });

  it("keeps the observed name when there is no canonical name to resolve", () => {
    expect(displayNameFor("default", "Default (recommended)")).toBe("Default (recommended)");
    expect(displayNameFor("some-unknown-model", "Some Unknown Model"))
      .toBe("Some Unknown Model");
  });

  it("falls back to the id when the harness observed no name at all", () => {
    expect(displayNameFor("mystery-model", null)).toBe("mystery-model");
  });

  it("leaves executable identity untouched", () => {
    const projected = projectHarnessLaunchOptions(response([
      { id: "claude-fable-5", observedName: "Fable" },
      { id: "sonnet", observedName: "Sonnet" },
    ]));
    expect(projected?.models.map((model) => model.id)).toEqual(["claude-fable-5", "sonnet"]);
    expect(projected?.defaultModelId).toBe("claude-fable-5");
  });
});
