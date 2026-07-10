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
  "workflow.include",
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

// Track 3c: scalar field types an agent-filled notify field may declare.
export const WORKFLOW_NOTIFY_FIELD_TYPES = ["string", "number", "boolean"] as const;
export type WorkflowNotifyFieldType = (typeof WORKFLOW_NOTIFY_FIELD_TYPES)[number];

// --- Sizing / caps (mirror constants/workflows.py) -----------------------------

export const WORKFLOW_SHORT_TEXT_MAX_LENGTH = 255;
export const WORKFLOW_MAX_STEPS = 50;
export const WORKFLOW_MAX_ARGS = 25;
export const WORKFLOW_MAX_AGENTS = 20;
export const WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS = 3;

/** Reserved reference first-segments (never legal emit names). */
export const WORKFLOW_RESERVED_REF_SEGMENTS = ["inputs", "steps", "fields"] as const;

/** Reserved emit-name prefix owned by the resolver's injected notify-fields emit. */
export const WORKFLOW_NOTIFY_FIELDS_EMIT_PREFIX = "__notify_fields";

export const WORKFLOW_GOAL_DEFAULT_MAX_TURNS = 25;
export const WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS = 90 * 60;
export const WORKFLOW_GOAL_DEFAULT_TOKEN_BUDGET = 400_000;

export const FREE_PLAN_MAX_WORKFLOWS_PER_USER = 1;

/** Max integration namespaces a workflow may declare (mirrors
 * `WORKFLOW_MAX_FUNCTION_PROVIDERS`, constants/workflows.py, L22). */
export const WORKFLOW_MAX_INTEGRATIONS = 25;

/**
 * The integration namespaces exposed to the editor's picker at launch (L21,
 * 2026-07-07): the issues service and Slack, the only two integrations with no
 * mid-run OAuth-refresh failure mode. OAuth-DCR providers (Linear, Notion,
 * Supabase) are deferred — see architecture doc §6.1/§6.6. E3: namespace-only —
 * no per-tool selection.
 */
export const WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES = ["issues", "slack"] as const;

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

/** One agent-filled notify field: a scalar type + optional description. */
export interface WorkflowNotifyFieldSpec {
  type: WorkflowNotifyFieldType;
  description?: string;
}

/**
 * Agent-filled notify fields (track 3c). The agent fills `schema`'s named scalar
 * fields (via the emit machinery) in `slot`, right before the notification sends;
 * the `message` references them as `{{fields.<name>}}`. Resolver-expanded into an
 * injected `agent.emit` + the notify with indexed refs — the runtime never sees
 * this block.
 */
export interface WorkflowNotifyAgentFields {
  slot: string;
  schema: Record<string, WorkflowNotifyFieldSpec>;
}

/** Slack-only notify (E1b): no channel discriminator. */
export interface NotifyStep extends StepBase {
  kind: "notify";
  slackChannelId: string;
  message: string;
  /** Optional agent-filled fields ({{fields.*}} in `message`); undefined = template-only. */
  agentFields?: WorkflowNotifyAgentFields;
}

/** Branch (C11/D3): switch on a prior emit's field; each case is continue|end. */
export interface BranchStep extends StepBase {
  kind: "branch";
  on: string;
  cases: Record<string, { to: WorkflowBranchTarget }>;
  reason?: string;
}

/**
 * Composition step (spec 3.5 / L20): inline another workflow's steps into this
 * workflow's single resolved plan. Definition-only — the server's resolver
 * splices the target's CURRENT version's steps at StartRun, before delivery, so
 * the runtime never sees a `workflow.include` step (there is no child run). `args`
 * maps the child's declared argument names to templated strings written in THIS
 * workflow's context (they may reference `{{args.*}}` / `{{steps...}}` here).
 */
export interface WorkflowIncludeStep extends StepBase {
  kind: "workflow.include";
  /** The included workflow's id (its current version's steps are inlined). */
  workflowId: string;
  /** child-input-name -> templated value (in this workflow's interpolation context). */
  args: Record<string, string>;
  /** Include handle: prefixes the child's emit names at resolution (optional). */
  name?: string;
}

export type WorkflowStep =
  | AgentPromptStep
  | AgentEmitStep
  | AgentConfigStep
  | ShellRunStep
  | ScmOpenPrStep
  | NotifyStep
  | BranchStep
  | WorkflowIncludeStep;

export interface WorkflowAgentNode {
  slot: string;
  harness: string;
  model: string;
  steps: WorkflowStep[];
  /**
   * Per-slot integration narrowing (track 3c phase 2, data-contract §3
   * "resolver-only change"). A subset of the workflow-level `integrations`
   * list — validated by the server + this file's `validation.ts` mirror.
   * Undefined (the default) = this slot keeps the full workflow-level list;
   * an explicit (possibly empty) array narrows just this slot's runtime
   * grant. Absence vs. an empty array are NOT the same thing.
   */
  integrations?: string[];
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
    case "workflow.include":
      return { kind, onFail: { ...DEFAULT_ON_FAIL }, workflowId: "", args: {} };
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

function parseNotifyAgentFields(raw: unknown): WorkflowNotifyAgentFields | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const rawSchema = asRecord(record.schema);
  const schema: Record<string, WorkflowNotifyFieldSpec> = {};
  if (rawSchema) {
    for (const [name, spec] of Object.entries(rawSchema)) {
      const specRecord = asRecord(spec);
      // Preserve the raw type (even an unrecognized one) so `validation.ts` can
      // surface an `invalid_definition` error, matching the server's parse — a bad
      // type must not be silently dropped before the validator sees it.
      const fieldSpec: WorkflowNotifyFieldSpec = {
        type: specRecord?.type as WorkflowNotifyFieldType,
      };
      const description = asString(specRecord?.description);
      if (description !== undefined) {
        fieldSpec.description = description;
      }
      schema[name] = fieldSpec;
    }
  }
  return { slot: asString(record.slot) ?? "", schema };
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
    case "notify": {
      const step: NotifyStep = {
        kind,
        ...base,
        slackChannelId: asString(record.slack_channel_id) ?? "",
        message: asString(record.message) ?? "",
      };
      const agentFields = parseNotifyAgentFields(record.agent_fields);
      if (agentFields) {
        step.agentFields = agentFields;
      }
      return step;
    }
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
    case "workflow.include": {
      const rawArgs = asRecord(record.args);
      const args: Record<string, string> = {};
      if (rawArgs) {
        for (const [key, value] of Object.entries(rawArgs)) {
          if (typeof value === "string") {
            args[key] = value;
          }
        }
      }
      return { kind, onFail, workflowId: asString(record.workflow_id) ?? "", args };
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
  const node: WorkflowAgentNode = {
    slot: asString(record.slot) ?? "",
    harness: asString(record.harness) ?? "",
    model: asString(record.model) ?? "",
    steps,
  };
  // Presence, not just truthiness — an explicit [] narrows to nothing, which
  // is different from the field being absent (keep workflow-level default). A
  // present-but-non-array value is preserved verbatim (not dropped) so
  // `validation.ts` can flag its shape as `invalid_definition`, matching the
  // server's parse rather than silently treating it as absent.
  if (record.integrations !== undefined) {
    node.integrations = Array.isArray(record.integrations)
      ? record.integrations.filter((v): v is string => typeof v === "string")
      : (record.integrations as unknown as string[]);
  }
  return node;
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
      if (step.agentFields) {
        base.agent_fields = {
          slot: step.agentFields.slot,
          schema: Object.fromEntries(
            Object.entries(step.agentFields.schema).map(([name, spec]) => [
              name,
              spec.description !== undefined
                ? { type: spec.type, description: spec.description }
                : { type: spec.type },
            ]),
          ),
        };
      }
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
    case "workflow.include": {
      base.workflow_id = step.workflowId;
      base.args = { ...step.args };
      return base;
    }
  }
}

function serializeAgentNode(node: WorkflowAgentNode): Record<string, unknown> {
  const out: Record<string, unknown> = {
    slot: node.slot,
    harness: node.harness,
    model: node.model,
    steps: node.steps.map(serializeStep),
  };
  if (node.integrations !== undefined) {
    // Guard the spread: parse may have preserved a present-but-non-array value
    // (an invalid definition the validator flags); pass it through verbatim.
    out.integrations = Array.isArray(node.integrations) ? [...node.integrations] : node.integrations;
  }
  return out;
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

// --- Flattening ------------------------------------------------------------------

/** A step plus the agent-node context it runs in, at its flattened run-order index. */
export interface FlatWorkflowStep {
  step: WorkflowStep;
  nodeIndex: number;
  slot: string;
  harness: string;
  /**
   * The resolved plan's structured step key (service.py `_resolve_definition`):
   * `${nodeIndex}.-.${stepIndexInNode}` — the "-" lane placeholder is reserved
   * for the future parallel-lane shape (§4) and never re-keys the contract.
   * This is how the server addresses step outputs / actions on the wire.
   */
  stepKey: string;
}

/**
 * Flatten every agent node's steps into one run-ordered list (spine order).
 * Consumers that need a single "step index" across the whole definition
 * (presentation, run-status, effective-config) build on this.
 */
export function flattenWorkflowSteps(definition: WorkflowDefinition): FlatWorkflowStep[] {
  const out: FlatWorkflowStep[] = [];
  definition.agents.forEach((node, nodeIndex) => {
    node.steps.forEach((step, stepIndex) => {
      out.push({
        step,
        nodeIndex,
        slot: node.slot,
        harness: node.harness,
        stepKey: `${nodeIndex}.-.${stepIndex}`,
      });
    });
  });
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

export function isWorkflowNotifyFieldType(value: unknown): value is WorkflowNotifyFieldType {
  return (
    typeof value === "string" && (WORKFLOW_NOTIFY_FIELD_TYPES as readonly string[]).includes(value)
  );
}
