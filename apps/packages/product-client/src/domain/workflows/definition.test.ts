import { describe, expect, it } from "vitest";
import fullFixture from "../../../../../../fixtures/contracts/workflow-definition/full.json";
import minimalFixture from "../../../../../../fixtures/contracts/workflow-definition/minimal.json";
import v2FullFixture from "../../../../../../fixtures/contracts/workflow-definition/v2-full.json";
import {
  createWorkflowDefinitionDraft,
  workflowDefinitionFromResponse,
  resolveCanonicalWorkflowModelId,
  workflowDefinitionToDraft,
  workflowDraftToWriteInput,
  workflowEffortOptions,
  type WorkflowAgentCatalog,
  type WorkflowDefinition,
} from "./definition";

const catalog: WorkflowAgentCatalog = {
  catalogVersion: "probe-7",
  defaultAgentKind: "cursor",
  agents: [{
    kind: "claude",
    displayName: "Claude",
    session: {
      supportsGoals: true,
      controls: [{ key: "effort", mapping: { liveConfigId: "effort" } }],
      models: [{
        id: "default",
        displayName: "Default",
        aliases: ["claude-default"],
        defaultVisible: true,
        status: "active",
        controls: { effort: { values: ["low", "high"] } },
      }, {
        id: "sonnet",
        displayName: "Sonnet",
        defaultVisible: true,
        status: "active",
        controls: { effort: { values: ["default", "low", "medium", "high", "max"] } },
      }, {
        id: "haiku",
        displayName: "Haiku",
        defaultVisible: true,
        status: "active",
        controls: {},
      }],
    },
  }, {
    kind: "codex",
    displayName: "Codex",
    session: {
      supportsGoals: true,
      models: [{
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        defaultVisible: true,
        status: "active",
        controls: { reasoning_effort: { values: ["low", "medium", "high", "xhigh"] } },
      }],
    },
  }, {
    kind: "cursor",
    displayName: "Cursor",
    session: {
      supportsGoals: false,
      controls: [{ key: "reasoning_effort", mapping: null }],
      models: [{
        id: "composer",
        displayName: "Composer",
        defaultVisible: true,
        status: "active",
        controls: { reasoning_effort: { values: ["medium"] } },
      }],
    },
  }],
};

describe("workflow definition draft", () => {
  it.each([
    ["minimal", minimalFixture],
    ["full", fullFixture],
  ])("consumes the %s cross-language response fixture", (_name, rawFixture) => {
    const definition = rawFixture as unknown as WorkflowDefinition;

    expect(Object.keys(rawFixture).sort()).toEqual([
      "createdAt",
      "defaultRepoConfigId",
      "deletedAt",
      "description",
      "id",
      "inputs",
      "revision",
      "schemaVersion",
      "stages",
      "title",
      "updatedAt",
      "userId",
      "validatedCatalogVersion",
    ].sort());
    expect(definition.schemaVersion).toBe(1);
    expect(definition.revision).toBeGreaterThan(0);
    expect(definition.validatedCatalogVersion).toBeTruthy();
    expect(workflowDefinitionToDraft(definition)).toMatchObject({
      title: definition.title,
      description: definition.description,
      defaultRepoConfigId: definition.defaultRepoConfigId,
      inputs: definition.inputs,
    });
  });

  it("keeps runtime-default model distinct from the real default model id", () => {
    const draft = createWorkflowDefinitionDraft(catalog);
    expect(draft.stages[0]?.harnessConfig.agentKind).toBe("cursor");
    expect(draft.stages[0]?.harnessConfig.modelId).toBeNull();
    draft.title = "Triage";
    draft.stages[0]!.steps[0]!.prompt = "Investigate";
    expect(workflowDraftToWriteInput(draft, catalog).stages[0]?.harnessConfig.modelId).toBeNull();

    draft.stages[0]!.harnessConfig.agentKind = "claude";
    draft.stages[0]!.harnessConfig.modelId = "default";
    expect(workflowDraftToWriteInput(draft, catalog).stages[0]?.harnessConfig.modelId)
      .toBe("default");
  });

  it("canonicalizes aliases and projects effort from the exact model matrix", () => {
    expect(resolveCanonicalWorkflowModelId(catalog, "claude", "claude-default"))
      .toBe("default");
    expect(workflowEffortOptions(catalog, "claude", "default").map((item) => item.value))
      .toEqual(["low", "high"]);
    expect(workflowEffortOptions(catalog, "claude", "haiku")).toEqual([]);
    expect(workflowEffortOptions(catalog, "cursor", "composer")).toEqual([]);
  });

});

describe("gen-2 rows on the shared endpoints", () => {
  it("maps a v1 response and skips a v2 response instead of crashing", () => {
    const v1 = workflowDefinitionFromResponse(
      fullFixture as unknown as Parameters<typeof workflowDefinitionFromResponse>[0],
    );
    expect(v1?.schemaVersion).toBe(1);

    // A gen-2 row has schemaVersion 2 and no stages key at all; before the
    // guard this mapper threw on response.stages.map and white-screened the
    // Workflows page.
    const v2 = workflowDefinitionFromResponse(
      v2FullFixture as unknown as Parameters<typeof workflowDefinitionFromResponse>[0],
    );
    expect(v2).toBeNull();
  });
});
