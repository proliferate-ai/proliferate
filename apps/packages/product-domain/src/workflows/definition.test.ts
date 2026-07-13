import { describe, expect, it } from "vitest";
import fullFixture from "../../../../../fixtures/contracts/workflow-definition/full.json";
import minimalFixture from "../../../../../fixtures/contracts/workflow-definition/minimal.json";
import {
  createWorkflowDefinitionDraft,
  resolveCanonicalWorkflowModelId,
  workflowDefinitionToDraft,
  workflowDraftToWriteInput,
  workflowEffortOptions,
  workflowModelOptions,
  type WorkflowAgentCatalog,
  type WorkflowCatalogModel,
  type WorkflowDefinition,
} from "./definition";
import { validateWorkflowDefinitionDraft } from "./validation";

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

  it("excludes models whose catalog visibility is omitted", () => {
    const catalogWithUncuratedModel: WorkflowAgentCatalog = {
      ...catalog,
      agents: catalog.agents.map((agent) => agent.kind === "claude"
        ? {
          ...agent,
          session: {
            ...agent.session,
            models: [
              ...agent.session.models,
              ({
                id: "uncurated",
                displayName: "Uncurated",
                status: "active",
                controls: {},
              } as unknown as WorkflowCatalogModel),
            ],
          },
        }
        : agent),
    };
    const draft = createWorkflowDefinitionDraft(catalogWithUncuratedModel);
    draft.title = "Triage";
    draft.stages[0] = {
      harnessConfig: { agentKind: "claude", modelId: "uncurated", effort: null },
      steps: [{ kind: "agent.prompt", prompt: "Investigate" }],
    };

    expect(workflowModelOptions(catalogWithUncuratedModel, "claude"))
      .not.toContainEqual(expect.objectContaining({ value: "uncurated" }));
    expect(validateWorkflowDefinitionDraft(draft, catalogWithUncuratedModel)).toContainEqual({
      path: "stages.0.harnessConfig.modelId",
      message: "Choose a model supported by this harness.",
    });
  });

  it("rejects harness-wide effort leakage and effort without an explicit model", () => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.stages[0]!.steps[0]!.prompt = "Investigate";
    draft.stages[0]!.harnessConfig.effort = "high";
    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "stages.0.harnessConfig.effort",
      message: "Choose a model before setting effort.",
    });

    draft.stages[0]!.harnessConfig.agentKind = "claude";
    draft.stages[0]!.harnessConfig.modelId = "haiku";
    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "stages.0.harnessConfig.effort",
      message: "Choose an effort supported by this exact model.",
    });
  });

  it.each([
    ["claude", "sonnet", "xhigh"],
    ["claude", "haiku", "high"],
    ["codex", "gpt-5.5", "ultra"],
  ])("rejects %s/%s effort %s outside the exact model matrix", (
    agentKind,
    modelId,
    effort,
  ) => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.stages[0] = {
      harnessConfig: { agentKind, modelId, effort },
      steps: [{ kind: "agent.prompt", prompt: "Investigate" }],
    };

    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "stages.0.harnessConfig.effort",
      message: "Choose an effort supported by this exact model.",
    });
  });

  it("validates goal support and input references", () => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.inputs = [{ name: "ticket", type: "string", required: true }];
    draft.stages[0] = {
      harnessConfig: { agentKind: "cursor", modelId: "composer", effort: null },
      steps: [{
        kind: "agent.prompt",
        prompt: "Investigate {{inputs.missing}}",
        goal: { objective: "Resolve {{ticket}}" },
      }],
    };

    const issues = validateWorkflowDefinitionDraft(draft, catalog);
    expect(issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      "Template references unknown input “missing”.",
      "Unsupported template expression “ticket”.",
      "This harness does not support goal-driven steps.",
    ]));
  });

  it("rejects whitespace variants of the exact input template grammar", () => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.inputs = [{ name: "ticket", type: "string", required: true }];
    draft.stages[0]!.steps[0]!.prompt = "Investigate {{ inputs.ticket }}";

    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "stages.0.steps.0.prompt",
      message: "Unsupported template expression “inputs.ticket”.",
    });
  });

  it("rejects unmatched template braces", () => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.stages[0]!.steps[0]!.prompt = "Investigate {{inputs.ticket";

    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "stages.0.steps.0.prompt",
      message: "Template expression is malformed.",
    });
  });

  it.each([
    "{{{inputs.ticket}}}",
    "{{inputs.ticket}}}",
    "{{{inputs.ticket}}",
  ])("rejects malformed brace supersets %s", (prompt) => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.inputs = [{ name: "ticket", type: "string", required: true }];
    draft.stages[0]!.steps[0]!.prompt = prompt;

    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "stages.0.steps.0.prompt",
      message: "Template expression is malformed.",
    });
  });

  it("rejects duplicate input names", () => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.inputs = [
      { name: "ticket", type: "string", required: true },
      { name: "ticket", type: "boolean", required: false },
    ];
    draft.stages[0]!.steps[0]!.prompt = "Investigate {{inputs.ticket}}";

    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "inputs.1.name",
      message: "Input “ticket” is duplicated.",
    });
  });

  it.each([
    ["{{inputs.missing}}", "Template references unknown input “missing”."],
    ["{{ticket}}", "Unsupported template expression “ticket”."],
    ["{{ inputs.ticket }}", "Unsupported template expression “inputs.ticket”."],
  ])("rejects non-contract prompt template %s", (prompt, message) => {
    const draft = createWorkflowDefinitionDraft(catalog);
    draft.title = "Triage";
    draft.inputs = [{ name: "ticket", type: "string", required: true }];
    draft.stages[0]!.steps[0]!.prompt = prompt;

    expect(validateWorkflowDefinitionDraft(draft, catalog)).toContainEqual({
      path: "stages.0.steps.0.prompt",
      message,
    });
  });
});
