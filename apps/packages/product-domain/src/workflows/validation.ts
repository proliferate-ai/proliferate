/**
 * Editor-facing validation of a workflow definition — format v2 (data-contract §1).
 *
 * Reproduces the server's strict rules (`parse_definition`) so the editor can
 * surface bad refs, missing caps, duplicate slots/emits, and uncovered branch
 * cases before a save round-trip. The server remains the authority.
 *
 * Every issue carries a `location` so the editor can attach it to the offending
 * agent node, step card, or input row. Steps are addressed by their *flattened*
 * run-order index across the whole spine.
 */

import {
  isWorkflowIdentifier,
  isWorkflowNotifyFieldType,
  isWorkflowSlot,
  WORKFLOW_BRANCH_TARGETS,
  WORKFLOW_MAX_AGENTS,
  WORKFLOW_MAX_ARGS,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_NOTIFY_FIELDS_EMIT_PREFIX,
  WORKFLOW_RESERVED_REF_SEGMENTS,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowInputSpec,
  type WorkflowStep,
} from "./definition";
import { iterReferences, validateStringReferences } from "./interpolation";

export interface WorkflowIssueLocation {
  scope: "inputs" | "integrations" | "agents" | "agent" | "step" | "input";
  /** Flattened run-order step index (across the whole spine). */
  stepIndex?: number;
  /** Agent node index. */
  nodeIndex?: number;
  inputIndex?: number;
  field?: string;
}

export interface WorkflowIssue {
  code: string;
  message: string;
  location: WorkflowIssueLocation;
}

export interface ValidateWorkflowOptions {
  harnessSupportsGoals?: (harness: string) => boolean;
  /**
   * The id of the workflow being edited, if it has one (spec 3.5). Used to flag a
   * `workflow.include` that targets the workflow itself (self-include). The full
   * include-graph CYCLE check is SERVER-ONLY: it must fetch other workflows'
   * current versions, which the editor doesn't have — the server is the authority.
   */
  workflowId?: string;
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
    case "agent.emit":
      return [{ field: "prompt", value: step.prompt }];
    case "agent.config":
      return [];
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
    case "branch":
      return [{ field: "on", value: step.on }];
    case "workflow.include":
      // Each input-mapping value is a templated string in THIS workflow's context
      // (spec 3.5 obl. a) — validate its refs against the parent's inputs/emits.
      return Object.entries(step.args).map(([key, value]) => ({
        field: `args.${key}`,
        value,
      }));
  }
}

function validateInputs(inputs: WorkflowInputSpec[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (inputs.length > WORKFLOW_MAX_ARGS) {
    issues.push({
      code: "too_many_args",
      message: `A workflow may declare at most ${WORKFLOW_MAX_ARGS} inputs.`,
      location: { scope: "inputs" },
    });
  }
  const seen = new Set<string>();
  inputs.forEach((input, inputIndex) => {
    if (input.name.trim() === "" || !isWorkflowIdentifier(input.name)) {
      issues.push({
        code: "invalid_definition",
        message: `Input name '${input.name}' must be an identifier.`,
        location: { scope: "input", inputIndex, field: "name" },
      });
    }
    if (seen.has(input.name)) {
      issues.push({
        code: "duplicate_arg",
        message: `Duplicate input name '${input.name}'.`,
        location: { scope: "input", inputIndex, field: "name" },
      });
    }
    seen.add(input.name);
    if (input.type === "choice") {
      const values = input.choices ?? [];
      if (values.length === 0) {
        issues.push({
          code: "invalid_definition",
          message: `Choice input '${input.name}' requires at least one value.`,
          location: { scope: "input", inputIndex, field: "choices" },
        });
      } else if (typeof input.default === "string" && !values.includes(input.default)) {
        issues.push({
          code: "invalid_definition",
          message: `Default for choice input '${input.name}' is not an allowed value.`,
          location: { scope: "input", inputIndex, field: "default" },
        });
      }
    }
  });
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
  harness: string,
  priorEmitNames: ReadonlySet<string>,
  allSlots: ReadonlySet<string>,
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
        if (
          options.harnessSupportsGoals
          && harness.trim() !== ""
          && !options.harnessSupportsGoals(harness)
        ) {
          push({
            code: "goal_unsupported_harness",
            message: `Goal iteration is not supported by ${harness}.`,
            location: { scope: "step", stepIndex, field: "goal" },
          });
        }
      }
      break;
    }
    case "agent.emit": {
      push(requireText(step.prompt, "Prompt text is required.", stepIndex, "prompt"));
      if (step.name.trim() === "" || !isWorkflowIdentifier(step.name)) {
        push({
          code: "invalid_definition",
          message: "Emit name must be an identifier.",
          location: { scope: "step", stepIndex, field: "name" },
        });
      } else if (
        (WORKFLOW_RESERVED_REF_SEGMENTS as readonly string[]).includes(step.name)
        || step.name.startsWith(WORKFLOW_NOTIFY_FIELDS_EMIT_PREFIX)
      ) {
        push({
          code: "invalid_definition",
          message: `Emit name '${step.name}' is reserved.`,
          location: { scope: "step", stepIndex, field: "name" },
        });
      }
      break;
    }
    case "agent.config":
      push(requireText(step.model, "A model is required.", stepIndex, "model"));
      break;
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
    case "notify": {
      push(requireText(step.message, "A message is required.", stepIndex, "message"));
      if (!step.slackChannelId.trim()) {
        push({
          code: "invalid_definition",
          message: "Choose a Slack channel.",
          location: { scope: "step", stepIndex, field: "slackChannelId" },
        });
      }
      if (step.agentFields) {
        if (!allSlots.has(step.agentFields.slot)) {
          push({
            code: "unknown_slot",
            message: `Agent-fields slot '${step.agentFields.slot}' is not an agent in this workflow.`,
            location: { scope: "step", stepIndex, field: "agentFields.slot" },
          });
        }
        const fieldNames = Object.keys(step.agentFields.schema);
        if (fieldNames.length === 0) {
          push({
            code: "invalid_definition",
            message: "Agent-fields needs at least one field.",
            location: { scope: "step", stepIndex, field: "agentFields.schema" },
          });
        }
        for (const [name, spec] of Object.entries(step.agentFields.schema)) {
          if (!isWorkflowIdentifier(name)) {
            push({
              code: "invalid_definition",
              message: `Agent-field name '${name}' must be an identifier.`,
              location: { scope: "step", stepIndex, field: "agentFields.schema" },
            });
          }
          if (!isWorkflowNotifyFieldType(spec.type)) {
            push({
              code: "invalid_definition",
              message: `Agent-field '${name}' must be a string, number, or boolean.`,
              location: { scope: "step", stepIndex, field: "agentFields.schema" },
            });
          }
        }
      }
      break;
    }
    case "branch": {
      // `on` must be exactly one emit ref, visible strictly earlier.
      const refs = iterReferences(step.on);
      const emitRefs = refs.filter((r) => r.kind === "emit");
      if (refs.length !== 1 || emitRefs.length !== 1) {
        push({
          code: "invalid_definition",
          message: "Branch must switch on exactly one {{EMIT.FIELD}} reference.",
          location: { scope: "step", stepIndex, field: "on" },
        });
      } else if (!priorEmitNames.has((emitRefs[0] as { emit: string }).emit)) {
        push({
          code: "forward_emit_reference",
          message: "Branch references an emit not produced by an earlier step.",
          location: { scope: "step", stepIndex, field: "on" },
        });
      }
      const caseKeys = Object.keys(step.cases);
      if (caseKeys.length === 0) {
        push({
          code: "invalid_definition",
          message: "A branch needs at least one case.",
          location: { scope: "step", stepIndex, field: "cases" },
        });
      }
      for (const [value, target] of Object.entries(step.cases)) {
        if (!(WORKFLOW_BRANCH_TARGETS as readonly string[]).includes(target.to)) {
          push({
            code: "invalid_definition",
            message: `Branch case '${value}' must route to continue or end.`,
            location: { scope: "step", stepIndex, field: "cases" },
          });
        }
      }
      break;
    }
    case "workflow.include": {
      if (step.workflowId.trim() === "") {
        push({
          code: "invalid_definition",
          message: "Choose a workflow to include.",
          location: { scope: "step", stepIndex, field: "workflowId" },
        });
      } else if (options.workflowId && step.workflowId === options.workflowId) {
        push({
          code: "self_include",
          message: "A workflow cannot include itself.",
          location: { scope: "step", stepIndex, field: "workflowId" },
        });
      }
      break;
    }
  }
  return issues;
}

function validateNode(
  node: WorkflowAgentNode,
  nodeIndex: number,
  seenSlots: Set<string>,
  workflowIntegrations: readonly string[],
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (node.slot.trim() === "" || !isWorkflowSlot(node.slot)) {
    issues.push({
      code: "invalid_definition",
      message: `Slot '${node.slot}' must match ^[a-z][a-z0-9_]*$.`,
      location: { scope: "agent", nodeIndex, field: "slot" },
    });
  }
  if (seenSlots.has(node.slot)) {
    issues.push({
      code: "duplicate_slot",
      message: `Duplicate agent slot '${node.slot}'.`,
      location: { scope: "agent", nodeIndex, field: "slot" },
    });
  }
  seenSlots.add(node.slot);
  if (node.harness.trim() === "") {
    issues.push({
      code: "invalid_definition",
      message: "An agent (harness) is required.",
      location: { scope: "agent", nodeIndex, field: "harness" },
    });
  }
  if (node.model.trim() === "") {
    issues.push({
      code: "invalid_definition",
      message: "A model is required.",
      location: { scope: "agent", nodeIndex, field: "model" },
    });
  }
  // Per-slot integration narrowing (track 3c phase 2, deny-path a): every
  // entry must be a member of the workflow-level `integrations` list.
  if (node.integrations !== undefined && !Array.isArray(node.integrations)) {
    // Present-but-non-array (parse preserved it verbatim): a shape error, matching
    // the server's "must be a list of namespace strings".
    issues.push({
      code: "invalid_definition",
      message: "Agent integrations must be a list of namespace strings.",
      location: { scope: "agent", nodeIndex, field: "integrations" },
    });
  } else if (node.integrations !== undefined) {
    const allowed = new Set(workflowIntegrations);
    const seenNarrowed = new Set<string>();
    for (const namespace of node.integrations) {
      if (!allowed.has(namespace)) {
        issues.push({
          code: "agent_integrations_not_subset",
          message: `Integration '${namespace}' is not in this workflow's integrations list.`,
          location: { scope: "agent", nodeIndex, field: "integrations" },
        });
      } else if (seenNarrowed.has(namespace)) {
        issues.push({
          code: "duplicate_integration",
          message: `Duplicate integration '${namespace}' on this agent.`,
          location: { scope: "agent", nodeIndex, field: "integrations" },
        });
      }
      seenNarrowed.add(namespace);
    }
  }
  return issues;
}

/** Validate a full definition. Returns all issues (empty when the draft is valid). */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions = {},
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  issues.push(...validateInputs(definition.inputs));

  if (definition.agents.length === 0) {
    issues.push({
      code: "invalid_definition",
      message: "A workflow needs at least one agent node.",
      location: { scope: "agents" },
    });
  }
  if (definition.agents.length > WORKFLOW_MAX_AGENTS) {
    issues.push({
      code: "too_many_agents",
      message: `A workflow may declare at most ${WORKFLOW_MAX_AGENTS} agent nodes.`,
      location: { scope: "agents" },
    });
  }

  const inputNames = new Set(definition.inputs.map((input) => input.name));
  const allSlots = new Set(definition.agents.map((node) => node.slot));
  const seenSlots = new Set<string>();
  const seenEmits = new Set<string>();
  const priorEmits = new Set<string>();
  let totalSteps = 0;
  let flatIndex = 0;

  definition.agents.forEach((node, nodeIndex) => {
    issues.push(...validateNode(node, nodeIndex, seenSlots, definition.integrations));
    totalSteps += node.steps.length;
    node.steps.forEach((step) => {
      const stepIndex = flatIndex;
      issues.push(...validateStep(step, stepIndex, options, node.harness, priorEmits, allSlots));
      // {{fields.*}} is scoped to a notify message that declared agent_fields.
      const allowedFields =
        step.kind === "notify" && step.agentFields
          ? new Set(Object.keys(step.agentFields.schema))
          : null;
      for (const { field, value } of templatedFields(step)) {
        const fieldsScope = field === "message" ? allowedFields : null;
        for (const refIssue of validateStringReferences(value, {
          inputNames,
          priorEmitNames: priorEmits,
          allowedFields: fieldsScope,
        })) {
          issues.push({
            code: refIssue.code,
            message: refIssue.message,
            location: { scope: "step", stepIndex, field },
          });
        }
      }
      // Register this step's emit AFTER validating its own refs.
      if (step.kind === "agent.emit" && step.name.trim() !== "") {
        if (seenEmits.has(step.name)) {
          issues.push({
            code: "duplicate_emit",
            message: `Duplicate emit name '${step.name}'.`,
            location: { scope: "step", stepIndex, field: "name" },
          });
        }
        seenEmits.add(step.name);
        priorEmits.add(step.name);
      }
      flatIndex += 1;
    });
  });

  if (totalSteps > WORKFLOW_MAX_STEPS) {
    issues.push({
      code: "too_many_steps",
      message: `A workflow may declare at most ${WORKFLOW_MAX_STEPS} steps.`,
      location: { scope: "agents" },
    });
  }

  return issues;
}

/** Whether a definition has no blocking issues. */
export function isWorkflowDefinitionValid(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions = {},
): boolean {
  return validateWorkflowDefinition(definition, options).length === 0;
}

/** First issue attached to a given flattened step index (card error affordance). */
export function stepIssues(issues: readonly WorkflowIssue[], stepIndex: number): WorkflowIssue[] {
  return issues.filter((issue) => issue.location.stepIndex === stepIndex);
}
