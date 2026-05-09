import { describe, expect, it } from "vitest";
import type {
  ModelRegistry,
  Session,
  WorkspaceSessionLaunchCatalog,
} from "@anyharness/sdk";
import {
  buildPausedModelAvailability,
  hasImmediateLaunchModelMismatch,
} from "@/lib/domain/sessions/creation/model-availability";

const registry: ModelRegistry = {
  kind: "codex",
  displayName: "Codex",
  defaultModelId: "gpt-5.4",
  models: [
    {
      id: "gpt-5.5",
      displayName: "GPT 5.5",
      isDefault: false,
      status: "active",
      aliases: ["gpt-5.5-latest"],
      minRuntimeVersion: null,
      launchRemediation: {
        kind: "managed_reinstall",
        message: "Update Codex tools and retry.",
      },
    },
    {
      id: "gpt-5.4",
      displayName: "GPT 5.4",
      isDefault: true,
      status: "active",
      aliases: [],
      minRuntimeVersion: null,
      launchRemediation: null,
    },
  ],
};

function sessionModelPair(
  requestedModelId: string,
  modelId: string,
): Session {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    agentKind: "codex",
    requestedModelId,
    modelId,
    status: "idle",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  } as Session;
}

function launchCatalog(modelIds: string[]): WorkspaceSessionLaunchCatalog {
  return {
    workspaceId: "workspace-1",
    catalogVersion: "test",
    agents: [
      {
        kind: "codex",
        displayName: "Codex",
        defaultModelId: modelIds[0] ?? null,
        models: modelIds.map((id) => ({
          id,
          displayName: id,
          isDefault: id === modelIds[0],
        })),
      },
    ],
  };
}

describe("hasImmediateLaunchModelMismatch", () => {
  it("requires a remediable requested model that is absent from the live launch catalog", () => {
    expect(hasImmediateLaunchModelMismatch({
      session: sessionModelPair("gpt-5.5", "gpt-5.4"),
      agentKind: "codex",
      registries: [registry],
      launchCatalog: launchCatalog(["gpt-5.4"]),
    })).toBe(true);
  });

  it("does not treat live-exposed aliases as unavailable", () => {
    expect(hasImmediateLaunchModelMismatch({
      session: sessionModelPair("gpt-5.5", "gpt-5.4"),
      agentKind: "codex",
      registries: [registry],
      launchCatalog: launchCatalog(["gpt-5.5-latest"]),
    })).toBe(false);
  });

  it("does not pause for mismatches without remediation metadata", () => {
    expect(hasImmediateLaunchModelMismatch({
      session: sessionModelPair("gpt-5.4", "gpt-5.5"),
      agentKind: "codex",
      registries: [registry],
      launchCatalog: launchCatalog(["gpt-5.5"]),
    })).toBe(false);
  });
});

describe("buildPausedModelAvailability", () => {
  it("builds the paused launch descriptor from requested and current models", () => {
    expect(buildPausedModelAvailability({
      session: sessionModelPair("gpt-5.5", "gpt-5.4"),
      workspaceId: "workspace-1",
      agentKind: "codex",
      registries: [registry],
    })).toEqual({
      id: "session-1:gpt-5.5:gpt-5.4",
      sessionId: "session-1",
      workspaceId: "workspace-1",
      agentKind: "codex",
      providerDisplayName: "Codex",
      requestedModelId: "gpt-5.5",
      requestedModelDisplayName: "GPT 5.5",
      currentModelId: "gpt-5.4",
      currentModelDisplayName: "GPT 5.4",
      remediation: {
        kind: "managed_reinstall",
        message: "Update Codex tools and retry.",
      },
    });
  });
});
