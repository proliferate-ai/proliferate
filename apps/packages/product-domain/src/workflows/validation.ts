/**
 * Editor-facing validation of a workflow definition (spec 3.3 / 3.6).
 *
 * Reproduces the server's strict rules (`parse_definition`) so the two-pane
 * editor can surface "bad refs, missing objective caps, empty steps" before a
 * save round-trip. The server remains the authority; this is fast local
 * feedback with the same shape of error.
 *
 * Every issue carries a `location` so the editor can attach it to the offending
 * step card, arg row, or panel field.
 */

import {
  isWorkflowIdentifier,
  WORKFLOW_MAX_ARGS,
  WORKFLOW_MAX_STEPS,
  type WorkflowArgSpec,
  type WorkflowDefinition,
  type WorkflowStep,
} from "./definition";
import { validateStringReferences } from "./interpolation";

export interface WorkflowIssueLocation {
  scope: "steps" | "args" | "setup" | "step" | "arg";
  stepIndex?: number;
  argIndex?: number;
  /** Panel field the issue is about (e.g. `prompt`, `goal.objective`). */
  field?: string;
}

export interface WorkflowIssue {
  code: string;
  message: string;
  location: WorkflowIssueLocation;
}

export interface ValidateWorkflowOptions {
  /**
   * Whether a given harness advertises `supports_goals`. Used to flag a goal
   * attached to a step whose effective harness cannot iterate. When omitted,
   * goal-capability is not checked (the editor gates the UI separately).
   */
  harnessSupportsGoals?: (harness: string) => boolean;
}

interface TemplatedField {
  field: string;
  value: string;
}

/** The user-templated string fields of a step, with their panel field paths. */
function templatedFields(step: WorkflowStep): TemplatedField[] {
  switch (step.kind) {
    case "agent.prompt": {
      const fields: TemplatedField[] = [{ field: "prompt", value: step.prompt }];
      if (step.goal) {
        fields.push({ field: "goal.objective", value: step.goal.objective });
        if (step.goal.verify) {
          fields.push({ field: "goal.verify.shell", value: step.goal.verify.shell });
        }
      }
      return fields;
    }
    case "shell.run":
      return [{ field: "command", value: step.command }];
    case "scm.open_pr": {
      const fields: TemplatedField[] = [{ field: "title", value: step.title }];
      if (step.base !== undefined) {
        fields.push({ field: "base", value: step.base });
      }
      if (step.body !== undefined) {
        fields.push({ field: "body", value: step.body });
      }
      return fields;
    }
    case "notify":
      return [{ field: "message", value: step.message }];
    case "human.approval":
      return [{ field: "message", value: step.message }];
  }
}

function validateArgs(args: WorkflowArgSpec[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (args.length > WORKFLOW_MAX_ARGS) {
    issues.push({
      code: "too_many_args",
      message: `A workflow may declare at most ${WORKFLOW_MAX_ARGS} arguments.`,
      location: { scope: "args" },
    });
  }
  const seen = new Set<string>();
  args.forEach((arg, argIndex) => {
    if (arg.name.trim() === "") {
      issues.push({
        code: "invalid_definition",
        message: "Argument name is required.",
        location: { scope: "arg", argIndex, field: "name" },
      });
    } else if (!isWorkflowIdentifier(arg.name)) {
      issues.push({
        code: "invalid_definition",
        message: `Argument name '${arg.name}' must be an identifier.`,
        location: { scope: "arg", argIndex, field: "name" },
      });
    }
    if (seen.has(arg.name)) {
      issues.push({
        code: "duplicate_arg",
        message: `Duplicate argument name '${arg.name}'.`,
        location: { scope: "arg", argIndex, field: "name" },
      });
    }
    seen.add(arg.name);
    if (arg.type === "enum") {
      const values = arg.enum ?? [];
      if (values.length === 0) {
        issues.push({
          code: "invalid_definition",
          message: `Enum argument '${arg.name}' requires at least one value.`,
          location: { scope: "arg", argIndex, field: "enum" },
        });
      } else if (
        typeof arg.default === "string"
        && !values.includes(arg.default)
      ) {
        issues.push({
          code: "invalid_definition",
          message: `Default for enum argument '${arg.name}' is not an allowed value.`,
          location: { scope: "arg", argIndex, field: "default" },
        });
      }
    }
  });
  return issues;
}

function validateSetup(definition: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (definition.setup.harness.trim() === "") {
    issues.push({
      code: "invalid_definition",
      message: "An agent (harness) is required.",
      location: { scope: "setup", field: "harness" },
    });
  }
  if (definition.setup.model.trim() === "") {
    issues.push({
      code: "invalid_definition",
      message: "A default model is required.",
      location: { scope: "setup", field: "model" },
    });
  }
  return issues;
}

function requireText(
  value: string,
  message: string,
  stepIndex: number,
  field: string,
): WorkflowIssue | null {
  return value.trim() === ""
    ? { code: "invalid_definition", message, location: { scope: "step", stepIndex, field } }
    : null;
}

function validateStep(
  step: WorkflowStep,
  stepIndex: number,
  options: ValidateWorkflowOptions,
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const push = (issue: WorkflowIssue | null) => {
    if (issue) {
      issues.push(issue);
    }
  };

  switch (step.kind) {
    case "agent.prompt": {
      push(requireText(step.prompt, "Prompt text is required.", stepIndex, "prompt"));
      if (step.goal) {
        push(requireText(step.goal.objective, "Goal objective is required.", stepIndex, "goal.objective"));
        if (!(step.goal.maxTurns > 0)) {
          push({
            code: "invalid_definition",
            message: "Goal max turns is required.",
            location: { scope: "step", stepIndex, field: "goal.maxTurns" },
          });
        }
        if (!(step.goal.maxWallSecs > 0)) {
          push({
            code: "invalid_definition",
            message: "Goal max time is required.",
            location: { scope: "step", stepIndex, field: "goal.maxWallSecs" },
          });
        }
        if (step.goal.verify) {
          push(requireText(step.goal.verify.shell, "Verify command is required.", stepIndex, "goal.verify.shell"));
        }
        const effectiveHarness = step.harnessOverride ?? null;
        if (
          options.harnessSupportsGoals
          && effectiveHarness !== null
          && !options.harnessSupportsGoals(effectiveHarness)
        ) {
          push({
            code: "goal_unsupported_harness",
            message: `Goal iteration is not supported by ${effectiveHarness}.`,
            location: { scope: "step", stepIndex, field: "goal" },
          });
        }
      }
      break;
    }
    case "shell.run": {
      push(requireText(step.command, "A command is required.", stepIndex, "command"));
      if (step.outputName !== undefined && !isWorkflowIdentifier(step.outputName)) {
        push({
          code: "invalid_definition",
          message: "Output name must be an identifier.",
          location: { scope: "step", stepIndex, field: "outputName" },
        });
      }
      break;
    }
    case "scm.open_pr":
      push(requireText(step.title, "A PR title is required.", stepIndex, "title"));
      break;
    case "notify":
      push(requireText(step.message, "A message is required.", stepIndex, "message"));
      break;
    case "human.approval":
      push(requireText(step.message, "An approval message is required.", stepIndex, "message"));
      break;
  }
  return issues;
}

/** Validate a full definition. Returns all issues (empty when the draft is valid). */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions = {},
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  issues.push(...validateArgs(definition.args));
  issues.push(...validateSetup(definition));

  if (definition.steps.length === 0) {
    issues.push({
      code: "invalid_definition",
      message: "A workflow needs at least one step.",
      location: { scope: "steps" },
    });
  }
  if (definition.steps.length > WORKFLOW_MAX_STEPS) {
    issues.push({
      code: "too_many_steps",
      message: `A workflow may declare at most ${WORKFLOW_MAX_STEPS} steps.`,
      location: { scope: "steps" },
    });
  }

  const argNames = new Set(definition.args.map((arg) => arg.name));
  definition.steps.forEach((step, stepIndex) => {
    issues.push(...validateStep(step, stepIndex, options));
    for (const { field, value } of templatedFields(step)) {
      for (const refIssue of validateStringReferences(value, { argNames, stepIndex })) {
        issues.push({
          code: refIssue.code,
          message: refIssue.message,
          location: { scope: "step", stepIndex, field },
        });
      }
    }
  });

  return issues;
}

/** Whether a definition has no blocking issues. */
export function isWorkflowDefinitionValid(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions = {},
): boolean {
  return validateWorkflowDefinition(definition, options).length === 0;
}

/** First issue attached to a given step (for the card error affordance). */
export function stepIssues(issues: readonly WorkflowIssue[], stepIndex: number): WorkflowIssue[] {
  return issues.filter((issue) => issue.location.stepIndex === stepIndex);
}
