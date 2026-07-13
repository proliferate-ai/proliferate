import type {
  WorkflowDefinitionCreateRequest,
  WorkflowDefinitionResponse,
  WorkflowDefinitionUpdateRequest,
} from "@proliferate/cloud-sdk";

export type WorkflowInputType = "string" | "number" | "boolean";

export interface WorkflowDefinitionInput {
  name: string;
  type: WorkflowInputType;
  required: boolean;
}

export interface WorkflowGoal {
  objective: string;
}

export interface WorkflowAgentPromptStep {
  kind: "agent.prompt";
  prompt: string;
  goal?: WorkflowGoal | null;
}

export interface WorkflowHarnessConfig {
  agentKind: string;
  modelId?: string | null;
  effort?: string | null;
}

export interface WorkflowDefinitionStage {
  harnessConfig: WorkflowHarnessConfig;
  steps: WorkflowAgentPromptStep[];
}

export interface WorkflowDefinition {
  id: string;
  userId: string;
  title: string;
  description: string;
  schemaVersion: 1;
  revision: number;
  validatedCatalogVersion: string;
  defaultRepoConfigId: string | null;
  inputs: WorkflowDefinitionInput[];
  stages: WorkflowDefinitionStage[];
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}

export interface WorkflowDefinitionDraft {
  title: string;
  description: string;
  defaultRepoConfigId: string | null;
  inputs: WorkflowDefinitionInput[];
  stages: WorkflowDefinitionStage[];
}

export interface WorkflowDefinitionWriteInput {
  title: string;
  description: string;
  defaultRepoConfigId: string | null;
  inputs: WorkflowDefinitionInput[];
  stages: WorkflowDefinitionStage[];
}

export interface WorkflowDefinitionUpdateInput extends WorkflowDefinitionWriteInput {
  expectedRevision: number;
}

export interface WorkflowCatalogModelControl {
  values?: readonly string[];
}

export interface WorkflowCatalogModel {
  id: string;
  displayName: string;
  aliases?: readonly string[];
  defaultVisible: boolean;
  status?: "active" | "candidate" | "deprecated" | "hidden";
  controls?: Readonly<Record<string, WorkflowCatalogModelControl>>;
}

export interface WorkflowCatalogAgent {
  kind: string;
  displayName: string;
  session: {
    supportsGoals?: unknown;
    controls?: readonly WorkflowCatalogSessionControl[];
    models: readonly WorkflowCatalogModel[];
  };
}

export interface WorkflowCatalogSessionControl {
  key: string;
  mapping?: {
    createField?: string | null;
    liveConfigId?: string | null;
  } | null;
}

export interface WorkflowAgentCatalog {
  catalogVersion: string;
  defaultAgentKind?: string | null;
  agents: readonly WorkflowCatalogAgent[];
}

export interface WorkflowCatalogOption {
  value: string;
  label: string;
}

export interface WorkflowValidationIssue {
  path: string;
  message: string;
}

export function createWorkflowDefinitionDraft(
  catalog: WorkflowAgentCatalog | null | undefined,
): WorkflowDefinitionDraft {
  return {
    title: "",
    description: "",
    defaultRepoConfigId: null,
    inputs: [],
    stages: [{
      harnessConfig: {
        agentKind: workflowDefaultAgentKind(catalog),
        modelId: null,
        effort: null,
      },
      steps: [{ kind: "agent.prompt", prompt: "", goal: null }],
    }],
  };
}

export function workflowDefinitionFromResponse(
  response: WorkflowDefinitionResponse,
): WorkflowDefinition {
  return {
    id: response.id,
    userId: response.userId,
    title: response.title,
    description: response.description,
    schemaVersion: 1,
    revision: response.revision,
    validatedCatalogVersion: response.validatedCatalogVersion,
    defaultRepoConfigId: response.defaultRepoConfigId,
    inputs: (response.inputs ?? []).map((input) => ({ ...input })),
    stages: response.stages.map((stage) => ({
      harnessConfig: { ...stage.harnessConfig },
      steps: stage.steps.map((step) => ({
        kind: "agent.prompt",
        prompt: step.prompt,
        goal: step.goal ? { objective: step.goal.objective } : null,
      })),
    })),
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    deletedAt: null,
  };
}

export function workflowDraftToCreateRequest(
  draft: WorkflowDefinitionDraft,
  catalog: WorkflowAgentCatalog | null | undefined,
): WorkflowDefinitionCreateRequest {
  return workflowDraftToWriteInput(draft, catalog);
}

export function workflowDraftToUpdateRequest(
  draft: WorkflowDefinitionDraft,
  expectedRevision: number,
  catalog: WorkflowAgentCatalog | null | undefined,
): WorkflowDefinitionUpdateRequest {
  return {
    ...workflowDraftToWriteInput(draft, catalog),
    expectedRevision,
  };
}

export function isWorkflowRevisionConflict(error: unknown): boolean {
  return error instanceof Error && (error as { status?: unknown }).status === 409;
}

export function workflowWriteErrorMessage(error: unknown): string {
  if (isWorkflowRevisionConflict(error)) {
    return "This workflow changed in another window. Reload it and apply your changes again.";
  }
  return error instanceof Error ? error.message : "Workflow could not be saved.";
}

export function workflowDefinitionToDraft(
  definition: WorkflowDefinition,
): WorkflowDefinitionDraft {
  return {
    title: definition.title,
    description: definition.description ?? "",
    defaultRepoConfigId: definition.defaultRepoConfigId,
    inputs: definition.inputs.map((input) => ({ ...input })),
    stages: definition.stages.map((stage) => ({
      harnessConfig: { ...stage.harnessConfig },
      steps: stage.steps.map((step) => ({
        ...step,
        goal: step.goal ? { ...step.goal } : null,
      })),
    })),
  };
}

export function workflowDraftToWriteInput(
  draft: WorkflowDefinitionDraft,
  catalog: WorkflowAgentCatalog | null | undefined,
): WorkflowDefinitionWriteInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    defaultRepoConfigId: draft.defaultRepoConfigId,
    inputs: draft.inputs.map((input) => ({
      ...input,
      name: input.name.trim(),
    })),
    stages: draft.stages.map((stage) => ({
      harnessConfig: {
        agentKind: stage.harnessConfig.agentKind,
        modelId: resolveCanonicalWorkflowModelId(
          catalog,
          stage.harnessConfig.agentKind,
          stage.harnessConfig.modelId,
        ),
        effort: stage.harnessConfig.effort || null,
      },
      steps: stage.steps.map((step) => ({
        kind: "agent.prompt",
        prompt: step.prompt,
        goal: step.goal ? { objective: step.goal.objective.trim() } : null,
      })),
    })),
  };
}

export function workflowAgentOptions(
  catalog: WorkflowAgentCatalog | null | undefined,
): WorkflowCatalogOption[] {
  return (catalog?.agents ?? [])
    .map((agent) => ({ value: agent.kind, label: agent.displayName }));
}

export function workflowDefaultAgentKind(
  catalog: WorkflowAgentCatalog | null | undefined,
): string {
  const options = workflowAgentOptions(catalog);
  return options.some((option) => option.value === catalog?.defaultAgentKind)
    ? catalog?.defaultAgentKind ?? ""
    : options[0]?.value ?? "";
}

export function workflowModelOptions(
  catalog: WorkflowAgentCatalog | null | undefined,
  agentKind: string,
): WorkflowCatalogOption[] {
  const agent = findWorkflowCatalogAgent(catalog, agentKind);
  return workflowVisibleModels(agent).map((model) => ({
    value: model.id,
    label: model.displayName,
  }));
}

export function workflowEffortOptions(
  catalog: WorkflowAgentCatalog | null | undefined,
  agentKind: string,
  modelId: string | null | undefined,
): WorkflowCatalogOption[] {
  const agent = findWorkflowCatalogAgent(catalog, agentKind);
  const model = findWorkflowCatalogModel(catalog, agentKind, modelId);
  const controlKey = ["effort", "reasoning_effort"].find((key) => {
    const control = agent?.session.controls?.find((candidate) => candidate.key === key);
    return Boolean(
      model?.controls?.[key]
      && (control?.mapping?.createField || control?.mapping?.liveConfigId),
    );
  });
  const values = controlKey ? model?.controls?.[controlKey]?.values ?? [] : [];
  return values.map((value) => ({ value, label: humanizeCatalogValue(value) }));
}

export function workflowAgentSupportsGoals(
  catalog: WorkflowAgentCatalog | null | undefined,
  agentKind: string,
): boolean {
  return findWorkflowCatalogAgent(catalog, agentKind)?.session.supportsGoals === true;
}

export function resolveCanonicalWorkflowModelId(
  catalog: WorkflowAgentCatalog | null | undefined,
  agentKind: string,
  modelId: string | null | undefined,
): string | null {
  if (!modelId) {
    return null;
  }
  return findWorkflowCatalogModel(catalog, agentKind, modelId)?.id ?? modelId;
}

export function findWorkflowCatalogAgent(
  catalog: WorkflowAgentCatalog | null | undefined,
  agentKind: string,
): WorkflowCatalogAgent | null {
  return catalog?.agents.find((agent) => agent.kind === agentKind) ?? null;
}

function workflowVisibleModels(
  agent: WorkflowCatalogAgent | null | undefined,
): WorkflowCatalogModel[] {
  return (agent?.session.models ?? []).filter((model) =>
    model.status === "active" && model.defaultVisible === true
  );
}

export function findWorkflowCatalogModel(
  catalog: WorkflowAgentCatalog | null | undefined,
  agentKind: string,
  modelId: string | null | undefined,
): WorkflowCatalogModel | null {
  if (!modelId) {
    return null;
  }
  return workflowVisibleModels(findWorkflowCatalogAgent(catalog, agentKind)).find((model) =>
    model.id === modelId || (model.aliases ?? []).includes(modelId)
  ) ?? null;
}

function humanizeCatalogValue(value: string): string {
  return value
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}
