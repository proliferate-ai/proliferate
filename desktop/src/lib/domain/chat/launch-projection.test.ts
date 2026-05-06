import { describe, expect, it } from "vitest";
import type { ModelRegistry, WorkspaceSessionLaunchAgent } from "@anyharness/sdk";
import { buildLaunchProjection } from "./launch-projection";

const effortControl = {
  key: "effort" as const,
  label: "Effort",
  defaultValue: "medium",
  values: [
    { value: "low", label: "Low", isDefault: false },
    { value: "medium", label: "Medium", isDefault: true },
    { value: "high", label: "High", isDefault: false },
  ],
};

function launchAgent(): WorkspaceSessionLaunchAgent {
  return {
    kind: "codex",
    displayName: "Codex",
    defaultModelId: "gpt-5.4",
    models: [{
      id: "gpt-5.4",
      displayName: "GPT 5.4",
      isDefault: true,
      sessionDefaultControls: [effortControl],
    }],
  };
}

function registry(): ModelRegistry {
  return {
    kind: "codex",
    displayName: "Codex",
    defaultModelId: "gpt-5.4",
    models: [{
      id: "gpt-5.4",
      displayName: "GPT 5.4",
      isDefault: true,
      status: "active",
      sessionDefaultControls: [effortControl],
    }],
  };
}

describe("buildLaunchProjection", () => {
  it("uses catalog defaults when no stored or scoped value is valid", () => {
    const projection = buildLaunchProjection({
      sourceKind: "configured-default",
      scopeId: "configured-default:workspace-1",
      selection: { kind: "codex", modelId: "gpt-5.4" },
      launchAgents: [launchAgent()],
      modelRegistries: [registry()],
      storedDefaults: { codex: { effort: "missing" } },
    });

    expect(projection?.controlValues).toEqual({ effort: "medium" });
  });

  it("lets scoped overrides outrank stored defaults", () => {
    const projection = buildLaunchProjection({
      sourceKind: "pending-session",
      scopeId: "pending-session:codex:1",
      selection: { kind: "codex", modelId: "gpt-5.4" },
      launchAgents: [launchAgent()],
      modelRegistries: [registry()],
      storedDefaults: { codex: { effort: "low" } },
      override: {
        controlValues: { effort: "high" },
      },
    });

    expect(projection?.controlValues).toEqual({ effort: "high" });
    expect(projection?.projectedControls[0]?.selectedValue.label).toBe("High");
  });

  it("falls back to registry controls when launch rows have none", () => {
    const projection = buildLaunchProjection({
      sourceKind: "pending-workspace",
      scopeId: "pending-workspace:attempt-1",
      selection: { kind: "codex", modelId: "gpt-5.4" },
      launchAgents: [{
        kind: "codex",
        displayName: "Codex",
        defaultModelId: "gpt-5.4",
        models: [{
          id: "gpt-5.4",
          displayName: "GPT 5.4",
          isDefault: true,
        }],
      }],
      modelRegistries: [registry()],
      storedDefaults: {},
    });

    expect(projection?.projectedControls.map((control) => control.key)).toEqual(["effort"]);
  });
});
