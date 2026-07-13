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
  defaultVisible?: boolean;
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

const INPUT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const TEMPLATE_TOKEN_PATTERN = /(?<!\{)\{\{([^{}]+)\}\}(?!\})/gu;
const MAX_DEFINITION_ITEMS = 64;

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

export function validateWorkflowDefinitionDraft(
  draft: WorkflowDefinitionDraft,
  catalog: WorkflowAgentCatalog | null | undefined,
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  if (!draft.title.trim()) {
    issues.push({ path: "title", message: "Add a workflow title." });
  } else if (draft.title.trim().length > 255) {
    issues.push({ path: "title", message: "Workflow titles must be 255 characters or fewer." });
  }
  if (draft.description.trim().length > 20_000) {
    issues.push({
      path: "description",
      message: "Workflow descriptions must be 20,000 characters or fewer.",
    });
  }
  if (draft.inputs.length > MAX_DEFINITION_ITEMS) {
    issues.push({ path: "inputs", message: "Workflows support at most 64 inputs." });
  }

  const inputNames = new Set<string>();
  draft.inputs.forEach((input, inputIndex) => {
    const path = `inputs.${inputIndex}.name`;
    const name = input.name.trim();
    if (name.length > 64) {
      issues.push({ path, message: "Input names must be 64 characters or fewer." });
    } else if (!INPUT_NAME_PATTERN.test(name)) {
      issues.push({
        path,
        message: "Input names must start with a letter and contain only letters, numbers, or underscores.",
      });
    } else if (inputNames.has(name)) {
      issues.push({ path, message: `Input “${name}” is duplicated.` });
    }
    inputNames.add(name);
  });

  if (draft.stages.length === 0) {
    issues.push({ path: "stages", message: "Add at least one stage." });
  } else if (draft.stages.length > MAX_DEFINITION_ITEMS) {
    issues.push({ path: "stages", message: "Workflows support at most 64 stages." });
  }

  draft.stages.forEach((stage, stageIndex) => {
    const stagePath = `stages.${stageIndex}`;
    const agent = findWorkflowCatalogAgent(catalog, stage.harnessConfig.agentKind);
    if (!agent) {
      issues.push({
        path: `${stagePath}.harnessConfig.agentKind`,
        message: "Choose an agent harness from the current catalog.",
      });
    }

    const modelId = stage.harnessConfig.modelId;
    const model = findWorkflowCatalogModel(catalog, stage.harnessConfig.agentKind, modelId);
    if (modelId && !model) {
      issues.push({
        path: `${stagePath}.harnessConfig.modelId`,
        message: "Choose a model supported by this harness.",
      });
    }

    const effort = stage.harnessConfig.effort;
    if (effort && !modelId) {
      issues.push({
        path: `${stagePath}.harnessConfig.effort`,
        message: "Choose a model before setting effort.",
      });
    } else if (effort && model) {
      const allowed = new Set(
        workflowEffortOptions(catalog, stage.harnessConfig.agentKind, model.id)
          .map((option) => option.value),
      );
      if (!allowed.has(effort)) {
        issues.push({
          path: `${stagePath}.harnessConfig.effort`,
          message: "Choose an effort supported by this exact model.",
        });
      }
    }

    if (stage.steps.length === 0) {
      issues.push({ path: `${stagePath}.steps`, message: "Add at least one prompt step." });
    } else if (stage.steps.length > MAX_DEFINITION_ITEMS) {
      issues.push({
        path: `${stagePath}.steps`,
        message: "A stage supports at most 64 prompt steps.",
      });
    }
    stage.steps.forEach((step, stepIndex) => {
      const stepPath = `${stagePath}.steps.${stepIndex}`;
      if (!step.prompt.trim()) {
        issues.push({ path: `${stepPath}.prompt`, message: "Add a prompt." });
      } else if (step.prompt.length > 100_000) {
        issues.push({
          path: `${stepPath}.prompt`,
          message: "Prompts must be 100,000 characters or fewer.",
        });
      }
      validateInputReferences(step.prompt, inputNames, `${stepPath}.prompt`, issues);
      if (step.goal) {
        if (!step.goal.objective.trim()) {
          issues.push({ path: `${stepPath}.goal.objective`, message: "Add a goal objective." });
        } else if (step.goal.objective.trim().length > 20_000) {
          issues.push({
            path: `${stepPath}.goal.objective`,
            message: "Goal objectives must be 20,000 characters or fewer.",
          });
        }
        validateInputReferences(
          step.goal.objective,
          inputNames,
          `${stepPath}.goal.objective`,
          issues,
        );
        if (!workflowAgentSupportsGoals(catalog, stage.harnessConfig.agentKind)) {
          issues.push({
            path: `${stepPath}.goal`,
            message: "This harness does not support goal-driven steps.",
          });
        }
      }
    });
  });

  return issues;
}

function findWorkflowCatalogAgent(
  catalog: WorkflowAgentCatalog | null | undefined,
  agentKind: string,
): WorkflowCatalogAgent | null {
  return catalog?.agents.find((agent) => agent.kind === agentKind) ?? null;
}

function workflowVisibleModels(
  agent: WorkflowCatalogAgent | null | undefined,
): WorkflowCatalogModel[] {
  return (agent?.session.models ?? []).filter((model) =>
    (model.status ?? "active") === "active" && model.defaultVisible !== false
  );
}

function findWorkflowCatalogModel(
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

function validateInputReferences(
  value: string,
  inputNames: ReadonlySet<string>,
  path: string,
  issues: WorkflowValidationIssue[],
): void {
  const unmatched = value.replace(TEMPLATE_TOKEN_PATTERN, "");
  if (unmatched.includes("{{") || unmatched.includes("}}")) {
    issues.push({ path, message: "Template expression is malformed." });
  }
  for (const token of value.matchAll(TEMPLATE_TOKEN_PATTERN)) {
    const expression = token[1] ?? "";
    const inputName = expression.startsWith("inputs.") ? expression.slice("inputs.".length) : null;
    if (!inputName || !INPUT_NAME_PATTERN.test(inputName)) {
      issues.push({ path, message: `Unsupported template expression “${expression.trim()}”.` });
      continue;
    }
    if (!inputNames.has(inputName)) {
      issues.push({ path, message: `Template references unknown input “${inputName}”.` });
    }
  }
}

function humanizeCatalogValue(value: string): string {
  return value
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}
