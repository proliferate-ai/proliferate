import { useMemo } from "react";
import type {
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
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Button } from "@proliferate/ui/primitives/Button";
import { X } from "@proliferate/ui/icons";
import { WorkflowStepKindBadge } from "@proliferate/product-ui/workflows/WorkflowStepKindBadge";
import { TemplateVarTextarea } from "./TemplateVarTextarea";
import { WorkflowGoalAttachment } from "./WorkflowGoalAttachment";

export interface EditorAgent {
  kind: string;
  displayName: string;
  models: { id: string; label: string }[];
}

export interface WorkflowStepPanelProps {
  step: WorkflowStep;
  setupHarness: string;
  agents: readonly EditorAgent[];
  suggestions: readonly TemplateSuggestion[];
  slackConnected: boolean;
  supportsGoals: (harnessKind: string) => boolean;
  onChange: (step: WorkflowStep) => void;
  onClose: () => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-ui-sm">{children}</Label>;
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
        ) : step.kind === "shell.run" ? (
          <ScriptEditor step={step} suggestions={props.suggestions} onChange={onChange} />
        ) : step.kind === "scm.open_pr" ? (
          <OpenPrEditor step={step} suggestions={props.suggestions} onChange={onChange} />
        ) : step.kind === "notify" ? (
          <NotifyEditor step={step} suggestions={props.suggestions} slackConnected={props.slackConnected} onChange={onChange} />
        ) : (
          <ApprovalEditor step={step} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function PromptEditor({
  step,
  setupHarness,
  agents,
  suggestions,
  supportsGoals,
  onChange,
}: WorkflowStepPanelProps & { step: AgentPromptStep }) {
  const effectiveHarness = step.harnessOverride ?? setupHarness;
  const effectiveAgent = agents.find((agent) => agent.kind === effectiveHarness);
  const harnessLabel = effectiveAgent?.displayName ?? effectiveHarness;
  const modelOptions = effectiveAgent?.models ?? [];

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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Model</FieldLabel>
          <Select
            value={step.modelOverride ?? ""}
            onChange={(event) =>
              onChange({ ...step, modelOverride: event.target.value || undefined })
            }
          >
            <option value="">inherit</option>
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Harness</FieldLabel>
          <Select
            value={step.harnessOverride ?? ""}
            onChange={(event) =>
              onChange({ ...step, harnessOverride: event.target.value || undefined })
            }
          >
            <option value="">inherit</option>
            {agents.map((agent) => (
              <option key={agent.kind} value={agent.kind}>
                {agent.displayName}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {step.harnessOverride ? (
        <p className="-mt-2 text-xs text-faint">Opens a new session in this workspace.</p>
      ) : null}

      <WorkflowGoalAttachment
        goal={step.goal}
        supportsGoals={supportsGoals(effectiveHarness)}
        harnessLabel={harnessLabel}
        suggestions={suggestions}
        onChange={(goal) => onChange({ ...step, goal })}
      />
      <p className="text-xs text-faint">Workflow runs use the agent's bypass mode.</p>
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
        <div className="flex items-start gap-2 rounded-md border border-border bg-foreground/[0.02] p-2">
          <span className="mt-1.5 font-mono text-ui-sm text-faint">$</span>
          <TemplateVarTextarea
            value={step.command}
            onChange={(command) => onChange({ ...step, command })}
            suggestions={suggestions}
            rows={3}
            mono
            ariaLabel="Command"
            placeholder="make test"
            invalid={step.command.trim() === ""}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Timeout (seconds)</FieldLabel>
          <Input
            type="number"
            min={1}
            value={step.timeoutSecs ?? ""}
            placeholder="none"
            onChange={(event) =>
              onChange({
                ...step,
                timeoutSecs: event.target.value === "" ? undefined : Number(event.target.value),
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Output name</FieldLabel>
          <Input
            value={step.outputName ?? ""}
            placeholder="results"
            onChange={(event) =>
              onChange({ ...step, outputName: event.target.value || undefined })
            }
          />
        </div>
      </div>
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
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Base branch</FieldLabel>
        <Input
          value={step.base ?? ""}
          placeholder="main"
          onChange={(event) => onChange({ ...step, base: event.target.value || undefined })}
        />
      </div>
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
      <label className="flex items-center justify-between gap-2">
        <span className="text-ui-sm text-foreground">Open as draft</span>
        <Switch checked={step.draft ?? false} onChange={(draft) => onChange({ ...step, draft })} />
      </label>
    </div>
  );
}

function NotifyEditor({
  step,
  suggestions,
  slackConnected,
  onChange,
}: {
  step: NotifyStep;
  suggestions: readonly TemplateSuggestion[];
  slackConnected: boolean;
  onChange: (step: WorkflowStep) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Channel</FieldLabel>
        <Select
          value={step.channel}
          onChange={(event) => onChange({ ...step, channel: event.target.value as WorkflowNotifyChannel })}
        >
          <option value="in_app">In-app</option>
          <option value="slack" disabled={!slackConnected}>
            Slack{slackConnected ? "" : " (connect to enable)"}
          </option>
        </Select>
        <p className="text-xs text-faint">Always recorded in-app and in run history.</p>
      </div>
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
      <div className="flex flex-col gap-1.5">
        <FieldLabel>On timeout</FieldLabel>
        <Select
          value={step.onTimeout}
          onChange={(event) => onChange({ ...step, onTimeout: event.target.value as WorkflowApprovalOnTimeout })}
        >
          {timeoutOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Timeout (seconds)</FieldLabel>
        <Input
          type="number"
          min={1}
          value={step.timeoutSecs ?? ""}
          placeholder="none"
          onChange={(event) =>
            onChange({
              ...step,
              timeoutSecs: event.target.value === "" ? undefined : Number(event.target.value),
            })
          }
        />
      </div>
      <p className="text-xs text-faint">Approver: the workflow owner.</p>
    </div>
  );
}
