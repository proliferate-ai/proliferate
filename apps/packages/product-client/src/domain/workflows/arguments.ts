import type {
  WorkflowInputDefinition,
  WorkflowInvocationCreateRequest,
} from "@proliferate/cloud-sdk";

export type WorkflowArgumentScalar = string | number | boolean;

export interface WorkflowArgumentDraftValue {
  supplied: boolean;
  value: string | boolean;
}

export type WorkflowArgumentDraft = Record<string, WorkflowArgumentDraftValue>;

export interface WorkflowArgumentIssue {
  path: string;
  code: "missing" | "invalid_number" | "unknown";
  message: string;
}

export interface WorkflowArgumentsResult {
  arguments: Record<string, WorkflowArgumentScalar>;
  issues: WorkflowArgumentIssue[];
}

const SAFE_INTEGER_LIMIT = 9_007_199_254_740_991;
const INPUT_REFERENCE = /\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}/gu;

export function createWorkflowArgumentDraft(
  inputs: readonly WorkflowInputDefinition[],
): WorkflowArgumentDraft {
  return Object.fromEntries(inputs.map((input) => [
    input.name,
    {
      supplied: false,
      value: input.type === "boolean" ? false : "",
    },
  ]));
}

export function referencedWorkflowInputNames(prompt: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of prompt.matchAll(INPUT_REFERENCE)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

export function normalizeWorkflowArguments(
  inputs: readonly WorkflowInputDefinition[],
  prompt: string,
  draft: WorkflowArgumentDraft,
): WorkflowArgumentsResult {
  const argumentsValue: Record<string, WorkflowArgumentScalar> = {};
  const issues: WorkflowArgumentIssue[] = [];
  const declared = new Set(inputs.map((input) => input.name));
  const referenced = referencedWorkflowInputNames(prompt);

  for (const key of Object.keys(draft)) {
    if (!declared.has(key)) {
      issues.push({
        path: `arguments.${key}`,
        code: "unknown",
        message: "This input is not declared by the workflow.",
      });
    }
  }

  for (const input of inputs) {
    const value = draft[input.name];
    const requiredForRun = input.required || referenced.has(input.name);
    if (!value?.supplied) {
      if (requiredForRun) {
        issues.push({
          path: `arguments.${input.name}`,
          code: "missing",
          message: input.required
            ? "This input is required."
            : "This optional input is used by the prompt and must be supplied for this run.",
        });
      }
      continue;
    }

    if (input.type === "boolean") {
      argumentsValue[input.name] = value.value === true;
      continue;
    }
    if (input.type === "string") {
      argumentsValue[input.name] = String(value.value);
      continue;
    }

    const raw = String(value.value).trim();
    const parsed = raw === "" ? Number.NaN : Number(raw);
    if (
      !Number.isFinite(parsed)
      || (Number.isInteger(parsed) && Math.abs(parsed) > SAFE_INTEGER_LIMIT)
    ) {
      issues.push({
        path: `arguments.${input.name}`,
        code: "invalid_number",
        message: "Enter a finite portable number within the safe integer range.",
      });
      continue;
    }
    argumentsValue[input.name] = Object.is(parsed, -0) ? 0 : parsed;
  }

  return { arguments: argumentsValue, issues };
}

export interface ManagedWorkflowLaunchAttempt {
  invocationId: string;
  request: WorkflowInvocationCreateRequest;
}

export function createManagedWorkflowLaunchAttempt(
  invocationId: string,
  workflowDefinitionId: string,
  expectedRevision: number,
  argumentsValue: Record<string, WorkflowArgumentScalar>,
): ManagedWorkflowLaunchAttempt {
  return {
    invocationId,
    request: {
      schemaVersion: 1,
      workflowDefinitionId,
      expectedRevision,
      arguments: { ...argumentsValue },
      target: { kind: "managedCloud" },
    },
  };
}
