import {
  type AgentConfigStep,
  type AgentPromptStep,
  type BranchStep,
  type NotifyStep,
  type ScmOpenPrStep,
  type ShellRunStep,
  type WorkflowBranchTarget,
  type WorkflowStep,
} from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { Input } from "@proliferate/ui/primitives/Input";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Button } from "@proliferate/ui/primitives/Button";
import { X } from "@proliferate/ui/icons";
import { WorkflowStepKindBadge } from "@proliferate/product-ui/workflows/WorkflowStepKindBadge";
import { TemplateVarTextarea } from "./TemplateVarTextarea";
import { WorkflowGoalAttachment } from "./WorkflowGoalAttachment";
import { WorkflowSelect } from "./WorkflowSelect";
import { FieldLabel, InlineRow } from "./WorkflowStepFields";
import { WorkflowEmitStepEditor } from "./WorkflowEmitStepEditor";
import { WorkflowIncludeStepEditor } from "./WorkflowIncludeStepEditor";
import {
  WorkflowRequiredInvocationField,
  type RequiredInvocationFunction,
} from "./WorkflowRequiredInvocationField";

export interface EditorAgent {
  kind: string;
  displayName: string;
  models: { id: string; label: string }[];
}

export interface EditorSlackChannel {
  id: string;
  name: string;
}

export interface EditorIncludableWorkflow {
  id: string;
  name: string;
}

export interface WorkflowStepPanelProps {
  step: WorkflowStep;
  /** The effective harness for this step's agent node (fixed per slot, v2). */
  effectiveHarness: string;
  agents: readonly EditorAgent[];
  suggestions: readonly TemplateSuggestion[];
  slackConnected: boolean;
  /** Channels the connected Slack account can post to; empty when not connected. */
  slackChannels: readonly EditorSlackChannel[];
  /** Owner's non-archived workflows (this one excluded) — the include picker. */
  includableWorkflows: readonly EditorIncludableWorkflow[];
  /** The workflow-declared integration namespaces (required-invocation universe). */
  integrations: readonly string[];
  /** The owner's function invocations (the `functions` provider's tools). */
  functionInvocations: readonly RequiredInvocationFunction[];
  supportsGoals: (harnessKind: string) => boolean;
  onChange: (step: WorkflowStep) => void;
  onClose: () => void;
}

export function WorkflowStepPanel(props: WorkflowStepPanelProps) {
  const { step, onChange, onClose } = props;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <WorkflowStepKindBadge kind={step.kind} />
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {step.kind === "agent.prompt" ? (
          <PromptEditor {...props} step={step} onChange={onChange} />
        ) : step.kind === "agent.emit" ? (
          <WorkflowEmitStepEditor
            key={step.id ?? "emit"}
            step={step}
            suggestions={props.suggestions}
            onChange={onChange}
          />
        ) : step.kind === "agent.config" ? (
          <AgentConfigEditor
            step={step}
            agents={props.agents}
            effectiveHarness={props.effectiveHarness}
            onChange={onChange}
          />
        ) : step.kind === "shell.run" ? (
          <ScriptEditor step={step} suggestions={props.suggestions} onChange={onChange} />
        ) : step.kind === "scm.open_pr" ? (
          <OpenPrEditor step={step} suggestions={props.suggestions} onChange={onChange} />
        ) : step.kind === "notify" ? (
          <NotifyEditor
            step={step}
            suggestions={props.suggestions}
            slackConnected={props.slackConnected}
            slackChannels={props.slackChannels}
            onChange={onChange}
          />
        ) : step.kind === "branch" ? (
          <BranchEditor step={step} onChange={onChange} />
        ) : (
          <WorkflowIncludeStepEditor
            step={step}
            suggestions={props.suggestions}
            includableWorkflows={props.includableWorkflows}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  );
}

function PromptEditor({
  step,
  effectiveHarness,
  agents,
  suggestions,
  integrations,
  functionInvocations,
  supportsGoals,
  onChange,
}: WorkflowStepPanelProps & { step: AgentPromptStep }) {
  const effectiveAgent = agents.find((agent) => agent.kind === effectiveHarness);
  const harnessLabel = effectiveAgent?.displayName ?? effectiveHarness;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Prompt</FieldLabel>
        <TemplateVarTextarea
          value={step.prompt}
          onChange={(prompt) => onChange({ ...step, prompt })}
          suggestions={suggestions}
          rows={5}
          ariaLabel="Prompt"
          placeholder="Investigate the failing tests and fix them."
          invalid={step.prompt.trim() === ""}
        />
      </div>

      <WorkflowGoalAttachment
        goal={step.goal}
        supportsGoals={supportsGoals(effectiveHarness)}
        harnessLabel={harnessLabel}
        suggestions={suggestions}
        onChange={(goal) => onChange({ ...step, goal })}
      />
      <WorkflowRequiredInvocationField
        value={step.requiredInvocation}
        integrations={integrations}
        functionInvocations={functionInvocations}
        onChange={(requiredInvocation) => onChange({ ...step, requiredInvocation })}
      />
      <p className="text-xs text-faint">
        Runs as <span className="text-muted-foreground">{harnessLabel}</span> in the agent's bypass mode.
      </p>
    </div>
  );
}

function AgentConfigEditor({
  step,
  agents,
  effectiveHarness,
  onChange,
}: {
  step: AgentConfigStep;
  agents: readonly EditorAgent[];
  effectiveHarness: string;
  onChange: (step: WorkflowStep) => void;
}) {
  // Harness never changes mid-slot (data contract §1.2) — model options scope
  // to the node's fixed harness.
  const modelAgent = agents.find((agent) => agent.kind === effectiveHarness);
  const modelOptions = modelAgent?.models ?? [];
  return (
    <div className="flex flex-col gap-4">
      <InlineRow label="Model">
        <WorkflowSelect
          ariaLabel="Model"
          value={step.model}
          options={modelOptions.map((model) => ({ value: model.id, label: model.label }))}
          onChange={(value) => onChange({ ...step, model: value })}
        />
      </InlineRow>
      <p className="text-xs text-faint">
        Applies to every step below, until the next Switch model step.
      </p>
      {!step.model.trim() ? <p className="text-xs text-destructive">Choose a model.</p> : null}
    </div>
  );
}

function ScriptEditor({
  step,
  suggestions,
  onChange,
}: {
  step: ShellRunStep;
  suggestions: readonly TemplateSuggestion[];
  onChange: (step: WorkflowStep) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Command</FieldLabel>
        <TemplateVarTextarea
          value={step.command}
          onChange={(command) => onChange({ ...step, command })}
          suggestions={suggestions}
          rows={3}
          mono
          gutter="$"
          ariaLabel="Command"
          placeholder="make test"
          invalid={step.command.trim() === ""}
        />
      </div>
      <InlineRow label="Timeout (s)">
        <Input
          type="number"
          min={1}
          className="w-32"
          value={step.timeoutSecs ?? ""}
          placeholder="none"
          onChange={(event) =>
            onChange({
              ...step,
              timeoutSecs: event.target.value === "" ? undefined : Number(event.target.value),
            })
          }
        />
      </InlineRow>
      <InlineRow label="Output name">
        <Input
          className="w-40"
          value={step.outputName ?? ""}
          placeholder="results"
          onChange={(event) =>
            onChange({ ...step, outputName: event.target.value || undefined })
          }
        />
      </InlineRow>
    </div>
  );
}

function OpenPrEditor({
  step,
  suggestions,
  onChange,
}: {
  step: ScmOpenPrStep;
  suggestions: readonly TemplateSuggestion[];
  onChange: (step: WorkflowStep) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <InlineRow label="Base branch">
        <Input
          className="w-44"
          value={step.base ?? ""}
          placeholder="main"
          onChange={(event) => onChange({ ...step, base: event.target.value || undefined })}
        />
      </InlineRow>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Title</FieldLabel>
        <Input
          value={step.title}
          placeholder="Fix failing tests"
          onChange={(event) => onChange({ ...step, title: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Body</FieldLabel>
        <TemplateVarTextarea
          value={step.body ?? ""}
          onChange={(body) => onChange({ ...step, body: body || undefined })}
          suggestions={suggestions}
          rows={4}
          ariaLabel="PR body"
        />
      </div>
      <InlineRow label="Open as draft">
        <Switch checked={step.draft ?? false} onChange={(draft) => onChange({ ...step, draft })} />
      </InlineRow>
    </div>
  );
}

/** Slack-only notify (E1b, data-contract §1.2): a channel pick + template message. */
function NotifyEditor({
  step,
  suggestions,
  slackConnected,
  slackChannels,
  onChange,
}: {
  step: NotifyStep;
  suggestions: readonly TemplateSuggestion[];
  slackConnected: boolean;
  slackChannels: readonly EditorSlackChannel[];
  onChange: (step: WorkflowStep) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <InlineRow label="Slack channel">
        {slackConnected ? (
          <WorkflowSelect
            ariaLabel="Slack channel"
            value={step.slackChannelId}
            placeholder="Choose a channel"
            options={slackChannels.map((channel) => ({
              value: channel.id,
              label: `#${channel.name}`,
            }))}
            onChange={(slackChannelId) => onChange({ ...step, slackChannelId })}
          />
        ) : (
          <span className="text-xs text-faint">Connect Slack in Settings → Integrations</span>
        )}
      </InlineRow>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Message</FieldLabel>
        <TemplateVarTextarea
          value={step.message}
          onChange={(message) => onChange({ ...step, message })}
          suggestions={suggestions}
          rows={4}
          ariaLabel="Notification message"
          placeholder="QA finished for PR #{{inputs.pr_number}}."
          invalid={step.message.trim() === ""}
        />
      </div>
    </div>
  );
}

const BRANCH_TARGETS: { value: WorkflowBranchTarget; label: string }[] = [
  { value: "continue", label: "Continue" },
  { value: "end", label: "End the run" },
];

/** Branch (C11/D3): switch on a prior emit field, each case routes continue|end. */
function BranchEditor({
  step,
  onChange,
}: {
  step: BranchStep;
  onChange: (step: WorkflowStep) => void;
}) {
  const setCase = (value: string, to: WorkflowBranchTarget) => {
    onChange({ ...step, cases: { ...step.cases, [value]: { to } } });
  };
  const removeCase = (value: string) => {
    const { [value]: _removed, ...rest } = step.cases;
    onChange({ ...step, cases: rest });
  };
  const addCase = () => {
    let value = "value";
    let i = 1;
    while (value in step.cases) {
      value = `value${i}`;
      i += 1;
    }
    setCase(value, "continue");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Switch on</FieldLabel>
        <Input
          className="font-mono"
          value={step.on}
          placeholder="{{verdict.decision}}"
          onChange={(event) => onChange({ ...step, on: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <FieldLabel>Cases</FieldLabel>
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={addCase}
          >
            Add case
          </Button>
        </div>
        {Object.entries(step.cases).map(([value, target]) => (
          <div key={value} className="flex items-center gap-2">
            <Input
              className="min-w-0 flex-1 font-mono"
              value={value}
              onChange={(event) => {
                removeCase(value);
                setCase(event.target.value, target.to);
              }}
            />
            <WorkflowSelect
              ariaLabel="Route"
              value={target.to}
              className="w-40"
              options={BRANCH_TARGETS}
              onChange={(next) => setCase(value, next as WorkflowBranchTarget)}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove case"
              onClick={() => removeCase(value)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        {Object.keys(step.cases).length === 0 ? (
          <p className="text-xs text-destructive">A branch needs at least one case.</p>
        ) : null}
      </div>
    </div>
  );
}
