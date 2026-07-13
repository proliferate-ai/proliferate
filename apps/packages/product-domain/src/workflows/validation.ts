import {
  findWorkflowCatalogAgent,
  findWorkflowCatalogModel,
  workflowAgentSupportsGoals,
  workflowEffortOptions,
  type WorkflowAgentCatalog,
  type WorkflowDefinitionDraft,
  type WorkflowValidationIssue,
} from "./definition";

const INPUT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const TEMPLATE_TOKEN_PATTERN = /(?<!\{)\{\{([^{}]+)\}\}(?!\})/gu;
const MAX_DEFINITION_ITEMS = 64;

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
