import { useMemo, type ReactNode } from "react";
import type {
  AgentConfigStep,
  AgentPromptStep,
  HumanApprovalStep,
  NotifyStep,
  ScmOpenPrStep,
  ShellRunStep,
  WorkflowApprovalOnTimeout,
  WorkflowNotifyChannel,
  WorkflowStep,
} from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Button } from "@proliferate/ui/primitives/Button";
import { X } from "@proliferate/ui/icons";
import { WorkflowStepKindBadge } from "@proliferate/product-ui/workflows/WorkflowStepKindBadge";
import { TemplateVarTextarea } from "./TemplateVarTextarea";
import { WorkflowGoalAttachment } from "./WorkflowGoalAttachment";
import { WorkflowSelect } from "./WorkflowSelect";

export interface EditorAgent {
  kind: string;
  displayName: string;
  models: { id: string; label: string }[];
}

export interface EditorSlackChannel {
  id: string;
  name: string;
}

export interface WorkflowStepPanelProps {
  step: WorkflowStep;
  /** The effective harness for this step — Setup harness folded through any
   * earlier `agent.config` steps. Drives goal-capability + model options. */
  effectiveHarness: string;
  agents: readonly EditorAgent[];
  suggestions: readonly TemplateSuggestion[];
  slackConnected: boolean;
  /** Channels the connected Slack account can post to; empty when not connected. */
  slackChannels: readonly EditorSlackChannel[];
  supportsGoals: (harnessKind: string) => boolean;
  onChange: (step: WorkflowStep) => void;
  onClose: () => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}

/** Label-left inline row (Family-4 C): fixed-width muted label, control right. */
function InlineRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-1 justify-end">{children}</div>
    </div>
  );
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
        ) : (
          <ApprovalEditor step={step} onChange={onChange} />
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
  // Model options scope to the chosen harness (or the inherited effective one).
  const modelAgent = agents.find((agent) => agent.kind === (step.harness ?? effectiveHarness));
  const modelOptions = modelAgent?.models ?? [];
  return (
    <div className="flex flex-col gap-4">
      <InlineRow label="Agent">
        <WorkflowSelect
          ariaLabel="Agent"
          value={step.harness ?? ""}
          options={[
            { value: "", label: "Keep current" },
            ...agents.map((agent) => ({ value: agent.kind, label: agent.displayName })),
          ]}
          onChange={(value) => onChange({ ...step, harness: value || undefined })}
        />
      </InlineRow>
      <InlineRow label="Model">
        <WorkflowSelect
          ariaLabel="Model"
          value={step.model ?? ""}
          options={[
            { value: "", label: "Keep current" },
            ...modelOptions.map((model) => ({ value: model.id, label: model.label })),
          ]}
          onChange={(value) => onChange({ ...step, model: value || undefined })}
        />
      </InlineRow>
      <p className="text-xs text-faint">
        Applies to every step below, until the next Agent step. Switching the agent opens a
        new session; a model-only change applies at the next session.
      </p>
      {!(step.harness?.trim() || step.model?.trim()) ? (
        <p className="text-xs text-destructive">Choose an agent or a model.</p>
      ) : null}
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
  const isSlack = step.channel === "slack";
  return (
    <div className="flex flex-col gap-4">
      <InlineRow label="Channel">
        <WorkflowSelect
          ariaLabel="Channel"
          value={step.channel}
          options={[
            { value: "in_app", label: "In-app" },
            {
              value: "slack",
              label: `Slack${slackConnected ? "" : " (connect to enable)"}`,
              triggerLabel: "Slack",
              disabled: !slackConnected,
            },
          ]}
          onChange={(value) =>
            onChange({
              ...step,
              channel: value as WorkflowNotifyChannel,
              slackChannelId: value === "slack" ? step.slackChannelId : undefined,
            })
          }
        />
      </InlineRow>
      <p className="-mt-1 text-xs text-faint">Always recorded in-app and in run history.</p>
      {isSlack ? (
        <InlineRow label="Slack channel">
          {slackConnected ? (
            <WorkflowSelect
              ariaLabel="Slack channel"
              value={step.slackChannelId ?? ""}
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
      ) : null}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Message</FieldLabel>
        <TemplateVarTextarea
          value={step.message}
          onChange={(message) => onChange({ ...step, message })}
          suggestions={suggestions}
          rows={4}
          ariaLabel="Notification message"
          placeholder="QA finished for PR #{{args.pr_number}}."
          invalid={step.message.trim() === ""}
        />
      </div>
    </div>
  );
}

function ApprovalEditor({
  step,
  onChange,
}: {
  step: HumanApprovalStep;
  onChange: (step: WorkflowStep) => void;
}) {
  const timeoutOptions = useMemo<{ value: WorkflowApprovalOnTimeout; label: string }[]>(
    () => [
      { value: "fail", label: "Fail the run" },
      { value: "continue", label: "Continue" },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Message</FieldLabel>
        <Input
          value={step.message}
          placeholder="Approve deploying to production?"
          onChange={(event) => onChange({ ...step, message: event.target.value })}
        />
      </div>
      <InlineRow label="On timeout">
        <WorkflowSelect
          ariaLabel="On timeout"
          value={step.onTimeout}
          options={timeoutOptions.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(value) => onChange({ ...step, onTimeout: value as WorkflowApprovalOnTimeout })}
        />
      </InlineRow>
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
      <p className="text-xs text-faint">Approver: the workflow owner.</p>
    </div>
  );
}
