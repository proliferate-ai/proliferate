/**
 * Pure workflow-definition model — format v2 (data-contract §1).
 *
 * Client-side mirror of the server schema (`server/.../workflows/domain/
 * definition.py` + `constants/workflows.py`). The v2 top-level shape is
 * `{version, name?, description?, inputs, integrations, agents}`: an ordered
 * spine of agent nodes (`{slot, harness, model, steps}`). There is no top-level
 * `steps` and no `setup` — slot = session affinity; `session_binding` is a
 * run-context property stamped on the resolved plan, never authored.
 *
 * The on-the-wire definition dict is snake_case (validated verbatim by the
 * control plane); the in-memory model here is camelCase for editor ergonomics.
 * `validation.ts` reproduces the server's strict checks for live feedback; the
 * server remains the authority on save.
 *
 * NOTE: the desktop editor components and sibling product-domain modules
 * (model.ts, presentation.ts, effective-config.ts, templates.ts) still consume
 * the v1 shape and are migrated in the editor phase.
 */

// --- Enumerations (mirror constants/workflows.py) ------------------------------

export const WORKFLOW_STEP_KINDS = [
  "agent.prompt",
  "agent.emit",
  "agent.config",
  "shell.run",
  "scm.open_pr",
  "notify",
  "branch",
] as const;
export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

// E2: text|number|choice|boolean (string->text, enum->choice).
export const WORKFLOW_INPUT_TYPES = ["text", "number", "choice", "boolean"] as const;
export type WorkflowInputType = (typeof WORKFLOW_INPUT_TYPES)[number];

export const WORKFLOW_ON_FAIL_KINDS = ["stop", "retry", "continue"] as const;
export type WorkflowOnFailKind = (typeof WORKFLOW_ON_FAIL_KINDS)[number];

export const WORKFLOW_GOAL_ON_BLOCKED = ["notify", "pause_for_approval", "fail"] as const;
export type WorkflowGoalOnBlocked = (typeof WORKFLOW_GOAL_ON_BLOCKED)[number];

// D3: branch cases narrow to continue|end.
export const WORKFLOW_BRANCH_TARGETS = ["continue", "end"] as const;
export type WorkflowBranchTarget = (typeof WORKFLOW_BRANCH_TARGETS)[number];

// --- Sizing / caps (mirror constants/workflows.py) -----------------------------

export const WORKFLOW_SHORT_TEXT_MAX_LENGTH = 255;
export const WORKFLOW_MAX_STEPS = 50;
export const WORKFLOW_MAX_ARGS = 25;
export const WORKFLOW_MAX_AGENTS = 20;
export const WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS = 3;

/** Reserved reference first-segments (never legal emit names). */
export const WORKFLOW_RESERVED_REF_SEGMENTS = ["inputs", "steps", "fields"] as const;

export const WORKFLOW_GOAL_DEFAULT_MAX_TURNS = 25;
export const WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS = 90 * 60;
export const WORKFLOW_GOAL_DEFAULT_TOKEN_BUDGET = 400_000;

export const FREE_PLAN_MAX_WORKFLOWS_PER_USER = 1;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SLOT_RE = /^[a-z][a-z0-9_]*$/;

/** Whether a string is a legal input / output / emit identifier (server rule). */
export function isWorkflowIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value);
}

/** Whether a string is a legal agent slot (server rule ^[a-z][a-z0-9_]*$). */
export function isWorkflowSlot(value: string): boolean {
  return SLOT_RE.test(value);
}

// --- Model ---------------------------------------------------------------------

export type WorkflowInputDefault = string | number | boolean;

export interface WorkflowInputSpec {
  name: string;
  type: WorkflowInputType;
  required: boolean;
  default?: WorkflowInputDefault;
  /** Only meaningful for `type: "choice"`. */
  choices?: string[];
}

export interface WorkflowOnFail {
  kind: WorkflowOnFailKind;
  /** Retry count; only present when `kind === "retry"`. */
  n?: number;
}

export interface WorkflowGoalVerify {
  shell: string;
  expectExit: number;
}

export interface WorkflowGoal {
  objective: string;
  maxTurns: number;
  maxWallSecs: number;
  tokenBudget?: number;
  onBlocked: WorkflowGoalOnBlocked;
  verify?: WorkflowGoalVerify;
}

export interface WorkflowRequiredInvocation {
  provider: string;
  tool: string;
}

interface StepBase {
  onFail: WorkflowOnFail;
  /** The one-line skim register (plain English). */
  label?: string;
}

export interface AgentPromptStep extends StepBase {
  kind: "agent.prompt";
  prompt: string;
  goal?: WorkflowGoal;
  /** L27 gate: require this provider+tool was invoked during the turn. */
  requiredInvocation?: WorkflowRequiredInvocation;
}

export interface AgentEmitStep extends StepBase {
  kind: "agent.emit";
  prompt: string;
  /** The output handle refs address (required, unique across the definition). */
  name: string;
  /** JSON Schema for the captured output. */
  outputSchema?: Record<string, unknown>;
  /** Re-ask budget (default 3). */
  maxAttempts?: number;
}

/** Switch-model step: narrows to `{model}` only (same-harness rule, A3). */
export interface AgentConfigStep extends StepBase {
  kind: "agent.config";
  model: string;
}

export interface ShellRunStep extends StepBase {
  kind: "shell.run";
  command: string;
  timeoutSecs?: number;
  outputName?: string;
}

export interface ScmOpenPrStep extends StepBase {
  kind: "scm.open_pr";
  title: string;
  base?: string;
  body?: string;
  draft?: boolean;
}

/** Slack-only notify (E1b): no channel discriminator. */
export interface NotifyStep extends StepBase {
  kind: "notify";
  slackChannelId: string;
  message: string;
}

/** Branch (C11/D3): switch on a prior emit's field; each case is continue|end. */
export interface BranchStep extends StepBase {
  kind: "branch";
  on: string;
  cases: Record<string, { to: WorkflowBranchTarget }>;
  reason?: string;
}

export type WorkflowStep =
  | AgentPromptStep
  | AgentEmitStep
  | AgentConfigStep
  | ShellRunStep
  | ScmOpenPrStep
  | NotifyStep
  | BranchStep;

export interface WorkflowAgentNode {
  slot: string;
  harness: string;
  model: string;
  steps: WorkflowStep[];
}

export interface WorkflowDefinition {
  version: 1;
  name?: string;
  description?: string;
  inputs: WorkflowInputSpec[];
  integrations: string[];
  agents: WorkflowAgentNode[];
}

// --- Constructors --------------------------------------------------------------

export function defaultWorkflowGoal(objective = ""): WorkflowGoal {
  return {
    objective,
    maxTurns: WORKFLOW_GOAL_DEFAULT_MAX_TURNS,
    maxWallSecs: WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS,
    tokenBudget: WORKFLOW_GOAL_DEFAULT_TOKEN_BUDGET,
    onBlocked: "notify",
  };
}

const DEFAULT_ON_FAIL: WorkflowOnFail = { kind: "stop" };

/** A blank step of the given kind, ready to edit. */
export function createWorkflowStep(kind: WorkflowStepKind): WorkflowStep {
  switch (kind) {
    case "agent.prompt":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, prompt: "" };
    case "agent.emit":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, prompt: "", name: "" };
    case "agent.config":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, model: "" };
    case "shell.run":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, command: "" };
    case "scm.open_pr":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, title: "" };
    case "notify":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, slackChannelId: "", message: "" };
    case "branch":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, on: "", cases: {} };
  }
}

export function createEmptyDefinition(node: WorkflowAgentNode): WorkflowDefinition {
  return { version: 1, inputs: [], integrations: [], agents: [node] };
}

// --- Parse (wire dict -> model) ------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseOnFail(raw: unknown): WorkflowOnFail {
  const record = asRecord(raw);
  const kind = record?.kind;
  if (kind === "retry") {
    return { kind: "retry", n: asPositiveInt(record?.n) ?? 1 };
  }
  if (kind === "continue") {
    return { kind: "continue" };
  }
  return { kind: "stop" };
}

function parseInput(raw: unknown): WorkflowInputSpec | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const name = asString(record.name);
  const type = record.type;
  if (name === undefined || !isWorkflowInputType(type)) {
    return null;
  }
  const spec: WorkflowInputSpec = { name, type, required: record.required === true };
  if (type === "choice" && Array.isArray(record.choices)) {
    spec.choices = record.choices.filter((v): v is string => typeof v === "string");
  }
  const rawDefault = record.default;
  if (
    typeof rawDefault === "string"
    || typeof rawDefault === "number"
    || typeof rawDefault === "boolean"
  ) {
    spec.default = rawDefault;
  }
  return spec;
}

function parseGoal(raw: unknown): WorkflowGoal | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const goal: WorkflowGoal = {
    objective: asString(record.objective) ?? "",
    maxTurns: asPositiveInt(record.max_turns) ?? WORKFLOW_GOAL_DEFAULT_MAX_TURNS,
    maxWallSecs: asPositiveInt(record.max_wall_secs) ?? WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS,
    onBlocked: isGoalOnBlocked(record.on_blocked) ? record.on_blocked : "notify",
  };
  const tokenBudget = asPositiveInt(record.token_budget);
  if (tokenBudget !== undefined) {
    goal.tokenBudget = tokenBudget;
  }
  const verify = asRecord(record.verify);
  if (verify) {
    goal.verify = {
      shell: asString(verify.shell) ?? "",
      expectExit: typeof verify.expect_exit === "number" ? verify.expect_exit : 0,
    };
  }
  return goal;
}

function parseStep(raw: unknown): WorkflowStep | null {
  const record = asRecord(raw);
  const kind = record?.kind;
  if (!record || !isWorkflowStepKind(kind)) {
    return null;
  }
  const onFail = parseOnFail(record.on_fail);
  const label = asString(record.label);
  const base = label !== undefined ? { onFail, label } : { onFail };
  switch (kind) {
    case "agent.prompt": {
      const step: AgentPromptStep = { kind, ...base, prompt: asString(record.prompt) ?? "" };
      const goal = record.goal == null ? undefined : parseGoal(record.goal);
      if (goal) {
        step.goal = goal;
      }
      const inv = asRecord(record.required_invocation);
      if (inv) {
        step.requiredInvocation = {
          provider: asString(inv.provider) ?? "",
          tool: asString(inv.tool) ?? "",
        };
      }
      return step;
    }
    case "agent.emit": {
      const step: AgentEmitStep = {
        kind,
        ...base,
        prompt: asString(record.prompt) ?? "",
        name: asString(record.name) ?? "",
      };
      const schema = asRecord(record.output_schema);
      if (schema) {
        step.outputSchema = schema;
      }
      const maxAttempts = asPositiveInt(record.max_attempts);
      if (maxAttempts !== undefined) {
        step.maxAttempts = maxAttempts;
      }
      return step;
    }
    case "agent.config":
      return { kind, ...base, model: asString(record.model) ?? "" };
    case "shell.run": {
      const step: ShellRunStep = { kind, ...base, command: asString(record.command) ?? "" };
      const timeoutSecs = asPositiveInt(record.timeout_secs);
      if (timeoutSecs !== undefined) {
        step.timeoutSecs = timeoutSecs;
      }
      const outputName = asString(record.output_name);
      if (outputName !== undefined) {
        step.outputName = outputName;
      }
      return step;
    }
    case "scm.open_pr": {
      const step: ScmOpenPrStep = { kind, ...base, title: asString(record.title) ?? "" };
      const b = asString(record.base);
      if (b !== undefined) {
        step.base = b;
      }
      const body = asString(record.body);
      if (body !== undefined) {
        step.body = body;
      }
      if (typeof record.draft === "boolean") {
        step.draft = record.draft;
      }
      return step;
    }
    case "notify":
      return {
        kind,
        ...base,
        slackChannelId: asString(record.slack_channel_id) ?? "",
        message: asString(record.message) ?? "",
      };
    case "branch": {
      const rawCases = asRecord(record.cases) ?? {};
      const cases: Record<string, { to: WorkflowBranchTarget }> = {};
      for (const [value, target] of Object.entries(rawCases)) {
        const to = asRecord(target)?.to;
        if (isBranchTarget(to)) {
          cases[value] = { to };
        }
      }
      const step: BranchStep = { kind, ...base, on: asString(record.on) ?? "", cases };
      const reason = asString(record.reason);
      if (reason !== undefined) {
        step.reason = reason;
      }
      return step;
    }
  }
}

function parseAgentNode(raw: unknown): WorkflowAgentNode | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const steps = Array.isArray(record.steps)
    ? record.steps.map(parseStep).filter((s): s is WorkflowStep => s !== null)
    : [];
  return {
    slot: asString(record.slot) ?? "",
    harness: asString(record.harness) ?? "",
    model: asString(record.model) ?? "",
    steps,
  };
}

/**
 * Lenient parse of a stored definition dict into the model. Never throws.
 */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  const record = asRecord(raw);
  const inputs = Array.isArray(record?.inputs)
    ? record.inputs.map(parseInput).filter((a): a is WorkflowInputSpec => a !== null)
    : [];
  const integrations = Array.isArray(record?.integrations)
    ? record.integrations.filter((v): v is string => typeof v === "string")
    : [];
  const agents = Array.isArray(record?.agents)
    ? record.agents.map(parseAgentNode).filter((n): n is WorkflowAgentNode => n !== null)
    : [];
  const def: WorkflowDefinition = { version: 1, inputs, integrations, agents };
  const name = asString(record?.name);
  if (name !== undefined) {
    def.name = name;
  }
  const description = asString(record?.description);
  if (description !== undefined) {
    def.description = description;
  }
  return def;
}

// --- Serialize (model -> wire dict) --------------------------------------------

function serializeInput(input: WorkflowInputSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: input.name,
    type: input.type,
    required: input.required,
  };
  if (input.type === "choice" && input.choices) {
    out.choices = [...input.choices];
  }
  if (input.default !== undefined) {
    out.default = input.default;
  }
  return out;
}

function serializeOnFail(onFail: WorkflowOnFail): Record<string, unknown> {
  return onFail.kind === "retry" ? { kind: "retry", n: onFail.n ?? 1 } : { kind: onFail.kind };
}

function serializeGoal(goal: WorkflowGoal): Record<string, unknown> {
  const out: Record<string, unknown> = {
    objective: goal.objective,
    max_turns: goal.maxTurns,
    max_wall_secs: goal.maxWallSecs,
    on_blocked: goal.onBlocked,
  };
  if (goal.tokenBudget !== undefined) {
    out.token_budget = goal.tokenBudget;
  }
  if (goal.verify) {
    out.verify = { shell: goal.verify.shell, expect_exit: goal.verify.expectExit };
  }
  return out;
}

function serializeStep(step: WorkflowStep): Record<string, unknown> {
  const base: Record<string, unknown> = { kind: step.kind, on_fail: serializeOnFail(step.onFail) };
  if (step.label !== undefined) {
    base.label = step.label;
  }
  switch (step.kind) {
    case "agent.prompt": {
      base.prompt = step.prompt;
      if (step.goal) {
        base.goal = serializeGoal(step.goal);
      }
      if (step.requiredInvocation) {
        base.required_invocation = {
          provider: step.requiredInvocation.provider,
          tool: step.requiredInvocation.tool,
        };
      }
      return base;
    }
    case "agent.emit": {
      base.prompt = step.prompt;
      base.name = step.name;
      if (step.outputSchema) {
        base.output_schema = step.outputSchema;
      }
      if (step.maxAttempts !== undefined) {
        base.max_attempts = step.maxAttempts;
      }
      return base;
    }
    case "agent.config":
      base.model = step.model;
      return base;
    case "shell.run": {
      base.command = step.command;
      if (step.timeoutSecs !== undefined) {
        base.timeout_secs = step.timeoutSecs;
      }
      if (step.outputName !== undefined) {
        base.output_name = step.outputName;
      }
      return base;
    }
    case "scm.open_pr": {
      base.title = step.title;
      if (step.base !== undefined) {
        base.base = step.base;
      }
      if (step.body !== undefined) {
        base.body = step.body;
      }
      if (step.draft !== undefined) {
        base.draft = step.draft;
      }
      return base;
    }
    case "notify":
      base.slack_channel_id = step.slackChannelId;
      base.message = step.message;
      return base;
    case "branch": {
      base.on = step.on;
      base.cases = Object.fromEntries(
        Object.entries(step.cases).map(([value, target]) => [value, { to: target.to }]),
      );
      if (step.reason !== undefined) {
        base.reason = step.reason;
      }
      return base;
    }
  }
}

function serializeAgentNode(node: WorkflowAgentNode): Record<string, unknown> {
  return {
    slot: node.slot,
    harness: node.harness,
    model: node.model,
    steps: node.steps.map(serializeStep),
  };
}

/** The snake_case definition dict to POST/PATCH. Inverse of parse. */
export function serializeWorkflowDefinition(
  definition: WorkflowDefinition,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    version: 1,
    inputs: definition.inputs.map(serializeInput),
    integrations: [...definition.integrations],
    agents: definition.agents.map(serializeAgentNode),
  };
  if (definition.name !== undefined) {
    out.name = definition.name;
  }
  if (definition.description !== undefined) {
    out.description = definition.description;
  }
  return out;
}

// --- Type guards ---------------------------------------------------------------

export function isWorkflowStepKind(value: unknown): value is WorkflowStepKind {
  return typeof value === "string" && (WORKFLOW_STEP_KINDS as readonly string[]).includes(value);
}

export function isWorkflowInputType(value: unknown): value is WorkflowInputType {
  return typeof value === "string" && (WORKFLOW_INPUT_TYPES as readonly string[]).includes(value);
}

function isGoalOnBlocked(value: unknown): value is WorkflowGoalOnBlocked {
  return typeof value === "string" && (WORKFLOW_GOAL_ON_BLOCKED as readonly string[]).includes(value);
}

function isBranchTarget(value: unknown): value is WorkflowBranchTarget {
  return typeof value === "string" && (WORKFLOW_BRANCH_TARGETS as readonly string[]).includes(value);
}
