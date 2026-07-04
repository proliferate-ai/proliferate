/**
 * Pure workflow-definition model (spec 3.3 / 3.6).
 *
 * This is the client-side mirror of the server definition schema
 * (`server/.../workflows/domain/definition.py` + `constants/workflows.py`).
 * The on-the-wire definition dict is **snake_case** (it is validated verbatim
 * by the control plane); the in-memory model here is **camelCase** for editor
 * ergonomics. `parseWorkflowDefinition` reads the wire dict into the model and
 * `serializeWorkflowDefinition` writes it back — the two are inverse.
 *
 * The editor edits a `WorkflowDefinition` directly (drag steps, toggle goals,
 * etc.); `validation.ts` reproduces the server's strict checks for live
 * feedback; the server remains the authority on save.
 */

// --- Enumerations (mirror constants/workflows.py) ------------------------------

export const WORKFLOW_STEP_KINDS = [
  "agent.prompt",
  "agent.config",
  "shell.run",
  "scm.open_pr",
  "notify",
  "human.approval",
] as const;
export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

export const WORKFLOW_ARG_TYPES = ["string", "number", "boolean", "enum"] as const;
export type WorkflowArgType = (typeof WORKFLOW_ARG_TYPES)[number];

export const WORKFLOW_SESSION_BINDINGS = ["fresh", "headless"] as const;
export type WorkflowSessionBinding = (typeof WORKFLOW_SESSION_BINDINGS)[number];

export const WORKFLOW_ON_FAIL_KINDS = ["stop", "retry", "continue"] as const;
export type WorkflowOnFailKind = (typeof WORKFLOW_ON_FAIL_KINDS)[number];

export const WORKFLOW_GOAL_ON_BLOCKED = ["notify", "pause_for_approval", "fail"] as const;
export type WorkflowGoalOnBlocked = (typeof WORKFLOW_GOAL_ON_BLOCKED)[number];

export const WORKFLOW_NOTIFY_CHANNELS = ["in_app", "slack"] as const;
export type WorkflowNotifyChannel = (typeof WORKFLOW_NOTIFY_CHANNELS)[number];

export const WORKFLOW_APPROVAL_ON_TIMEOUT = ["fail", "continue"] as const;
export type WorkflowApprovalOnTimeout = (typeof WORKFLOW_APPROVAL_ON_TIMEOUT)[number];

// --- Sizing / caps (mirror constants/workflows.py) -----------------------------

export const WORKFLOW_SHORT_TEXT_MAX_LENGTH = 255;
export const WORKFLOW_MAX_STEPS = 50;
export const WORKFLOW_MAX_ARGS = 25;

/** Spec 3.6: default goal caps offered in the editor (25 turns / 90m / 400k). */
export const WORKFLOW_GOAL_DEFAULT_MAX_TURNS = 25;
export const WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS = 90 * 60;
export const WORKFLOW_GOAL_DEFAULT_TOKEN_BUDGET = 400_000;

/** Spec 6: free-plan cap, enforced client-side + server-side. */
export const FREE_PLAN_MAX_WORKFLOWS_PER_USER = 1;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether a string is a legal arg / output identifier (server rule). */
export function isWorkflowIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value);
}

// --- Model ---------------------------------------------------------------------

export type WorkflowArgDefault = string | number | boolean;

export interface WorkflowArgSpec {
  name: string;
  type: WorkflowArgType;
  required: boolean;
  default?: WorkflowArgDefault;
  /** Only meaningful for `type: "enum"`. */
  enum?: string[];
}

export interface WorkflowSetup {
  harness: string;
  model: string;
  sessionBinding: WorkflowSessionBinding;
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

interface StepBase {
  onFail: WorkflowOnFail;
}

export interface AgentPromptStep extends StepBase {
  kind: "agent.prompt";
  prompt: string;
  /** Goal attachment — arms a native goal for this prompt. */
  goal?: WorkflowGoal;
}

/**
 * Sets the active agent (harness and/or model) for every step below it, until
 * the next `agent.config`. Switching harness opens a new session; a model-only
 * change applies at the next session creation. At least one of harness/model is
 * required (the editor + server enforce this).
 */
export interface AgentConfigStep extends StepBase {
  kind: "agent.config";
  harness?: string;
  model?: string;
}

export interface ShellRunStep extends StepBase {
  kind: "shell.run";
  command: string;
  timeoutSecs?: number;
  /** Named output capture for `{{steps[N].output.<name>}}`. */
  outputName?: string;
}

export interface ScmOpenPrStep extends StepBase {
  kind: "scm.open_pr";
  title: string;
  base?: string;
  body?: string;
  draft?: boolean;
}

export interface NotifyStep extends StepBase {
  kind: "notify";
  channel: WorkflowNotifyChannel;
  message: string;
}

export interface HumanApprovalStep extends StepBase {
  kind: "human.approval";
  message: string;
  onTimeout: WorkflowApprovalOnTimeout;
  timeoutSecs?: number;
}

export type WorkflowStep =
  | AgentPromptStep
  | AgentConfigStep
  | ShellRunStep
  | ScmOpenPrStep
  | NotifyStep
  | HumanApprovalStep;

export interface WorkflowDefinition {
  args: WorkflowArgSpec[];
  setup: WorkflowSetup;
  steps: WorkflowStep[];
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
    case "agent.config":
      return { kind, onFail: { ...DEFAULT_ON_FAIL } };
    case "shell.run":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, command: "" };
    case "scm.open_pr":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, title: "" };
    case "notify":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, channel: "in_app", message: "" };
    case "human.approval":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, message: "", onTimeout: "fail" };
  }
}

export function createEmptyDefinition(setup: WorkflowSetup): WorkflowDefinition {
  return { args: [], setup, steps: [createWorkflowStep("agent.prompt")] };
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
    const n = asPositiveInt(record?.n) ?? 1;
    return { kind: "retry", n };
  }
  if (kind === "continue") {
    return { kind: "continue" };
  }
  return { kind: "stop" };
}

function parseArg(raw: unknown): WorkflowArgSpec | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const name = asString(record.name);
  const type = record.type;
  if (name === undefined || !isWorkflowArgType(type)) {
    return null;
  }
  const spec: WorkflowArgSpec = {
    name,
    type,
    required: record.required === true,
  };
  if (type === "enum" && Array.isArray(record.enum)) {
    spec.enum = record.enum.filter((v): v is string => typeof v === "string");
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
  switch (kind) {
    case "agent.prompt": {
      const step: AgentPromptStep = { kind, onFail, prompt: asString(record.prompt) ?? "" };
      const goal = record.goal === undefined || record.goal === null
        ? undefined
        : parseGoal(record.goal);
      if (goal) {
        step.goal = goal;
      }
      return step;
    }
    case "agent.config": {
      const step: AgentConfigStep = { kind, onFail };
      const harness = asString(record.harness);
      if (harness !== undefined) {
        step.harness = harness;
      }
      const model = asString(record.model);
      if (model !== undefined) {
        step.model = model;
      }
      return step;
    }
    case "shell.run": {
      const step: ShellRunStep = { kind, onFail, command: asString(record.command) ?? "" };
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
      const step: ScmOpenPrStep = { kind, onFail, title: asString(record.title) ?? "" };
      const base = asString(record.base);
      if (base !== undefined) {
        step.base = base;
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
    case "notify": {
      const channel = isNotifyChannel(record.channel) ? record.channel : "in_app";
      return { kind, onFail, channel, message: asString(record.message) ?? "" };
    }
    case "human.approval": {
      const step: HumanApprovalStep = {
        kind,
        onFail,
        message: asString(record.message) ?? "",
        onTimeout: isApprovalOnTimeout(record.on_timeout) ? record.on_timeout : "fail",
      };
      const timeoutSecs = asPositiveInt(record.timeout_secs);
      if (timeoutSecs !== undefined) {
        step.timeoutSecs = timeoutSecs;
      }
      return step;
    }
  }
}

function parseSetup(raw: unknown): WorkflowSetup {
  const record = asRecord(raw);
  const binding = record?.session_binding;
  return {
    harness: asString(record?.harness) ?? "",
    model: asString(record?.model) ?? "",
    sessionBinding: isSessionBinding(binding) ? binding : "fresh",
  };
}

/**
 * Lenient parse of a stored/template definition dict into the model. Unknown or
 * malformed steps/args are dropped (they never occur in practice — the server
 * validated on write). Never throws.
 */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  const record = asRecord(raw);
  const args = Array.isArray(record?.args)
    ? record.args.map(parseArg).filter((a): a is WorkflowArgSpec => a !== null)
    : [];
  const steps = Array.isArray(record?.steps)
    ? record.steps.map(parseStep).filter((s): s is WorkflowStep => s !== null)
    : [];
  return { args, setup: parseSetup(record?.setup), steps };
}

// --- Serialize (model -> wire dict) --------------------------------------------

function serializeArg(arg: WorkflowArgSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: arg.name,
    type: arg.type,
    required: arg.required,
  };
  if (arg.type === "enum" && arg.enum) {
    out.enum = [...arg.enum];
  }
  if (arg.default !== undefined) {
    out.default = arg.default;
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
  switch (step.kind) {
    case "agent.prompt": {
      base.prompt = step.prompt;
      if (step.goal) {
        base.goal = serializeGoal(step.goal);
      }
      return base;
    }
    case "agent.config": {
      if (step.harness !== undefined) {
        base.harness = step.harness;
      }
      if (step.model !== undefined) {
        base.model = step.model;
      }
      return base;
    }
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
    case "notify": {
      base.channel = step.channel;
      base.message = step.message;
      return base;
    }
    case "human.approval": {
      base.message = step.message;
      base.on_timeout = step.onTimeout;
      if (step.timeoutSecs !== undefined) {
        base.timeout_secs = step.timeoutSecs;
      }
      return base;
    }
  }
}

/** The snake_case definition dict to POST/PATCH. Inverse of parse. */
export function serializeWorkflowDefinition(
  definition: WorkflowDefinition,
): Record<string, unknown> {
  return {
    args: definition.args.map(serializeArg),
    setup: {
      harness: definition.setup.harness,
      model: definition.setup.model,
      session_binding: definition.setup.sessionBinding,
    },
    steps: definition.steps.map(serializeStep),
  };
}

// --- Type guards ---------------------------------------------------------------

export function isWorkflowStepKind(value: unknown): value is WorkflowStepKind {
  return typeof value === "string" && (WORKFLOW_STEP_KINDS as readonly string[]).includes(value);
}

export function isWorkflowArgType(value: unknown): value is WorkflowArgType {
  return typeof value === "string" && (WORKFLOW_ARG_TYPES as readonly string[]).includes(value);
}

function isSessionBinding(value: unknown): value is WorkflowSessionBinding {
  return (
    typeof value === "string" && (WORKFLOW_SESSION_BINDINGS as readonly string[]).includes(value)
  );
}

function isGoalOnBlocked(value: unknown): value is WorkflowGoalOnBlocked {
  return typeof value === "string" && (WORKFLOW_GOAL_ON_BLOCKED as readonly string[]).includes(value);
}

function isNotifyChannel(value: unknown): value is WorkflowNotifyChannel {
  return (
    typeof value === "string" && (WORKFLOW_NOTIFY_CHANNELS as readonly string[]).includes(value)
  );
}

function isApprovalOnTimeout(value: unknown): value is WorkflowApprovalOnTimeout {
  return (
    typeof value === "string" && (WORKFLOW_APPROVAL_ON_TIMEOUT as readonly string[]).includes(value)
  );
}
