import { useState } from "react";
import {
  type WorkflowArgSpec,
  type WorkflowArgType,
  type WorkflowSessionBinding,
  type WorkflowSetup,
} from "@proliferate/product-domain/workflows/definition";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown, ChevronRight, Plus, X } from "@proliferate/ui/icons";
import {
  AgentHarnessModelSelector,
  type AgentHarnessModelGroup,
} from "@/components/agents/AgentHarnessModelSelector";
import type { EditorAgent } from "./WorkflowStepPanel";
import { WorkflowSelect } from "./WorkflowSelect";

export interface WorkflowSetupCardProps {
  setup: WorkflowSetup;
  args: WorkflowArgSpec[];
  agents: readonly EditorAgent[];
  onSetupChange: (setup: WorkflowSetup) => void;
  onArgsChange: (args: WorkflowArgSpec[]) => void;
}

const ARG_TYPES: WorkflowArgType[] = ["string", "number", "boolean", "enum"];

function summaryText(setup: WorkflowSetup, agents: readonly EditorAgent[], argCount: number): string {
  const agent = agents.find((a) => a.kind === setup.harness);
  const harness = agent?.displayName ?? (setup.harness || "No agent");
  const model = agent?.models.find((m) => m.id === setup.model)?.label ?? setup.model;
  const parts = [harness];
  if (model) {
    parts.push(model);
  }
  parts.push(setup.sessionBinding === "headless" ? "headless" : "fresh");
  if (argCount > 0) {
    parts.push(`${argCount} ${argCount === 1 ? "arg" : "args"}`);
  }
  return parts.join(" · ");
}

function ArgRow({
  arg,
  onChange,
  onRemove,
}: {
  arg: WorkflowArgSpec;
  onChange: (arg: WorkflowArgSpec) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/70 p-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={arg.name}
          placeholder="name"
          className="flex-1 font-mono text-ui-sm"
          onChange={(event) => onChange({ ...arg, name: event.target.value })}
        />
        <WorkflowSelect
          ariaLabel="Argument type"
          value={arg.type}
          className="w-28"
          menuWidthClassName="w-32"
          align="end"
          options={ARG_TYPES.map((type) => ({ value: type, label: type }))}
          onChange={(value) => {
            const type = value as WorkflowArgType;
            const next: WorkflowArgSpec = { ...arg, type };
            if (type === "enum" && !next.enum) {
              next.enum = [];
            }
            if (type !== "enum") {
              delete next.enum;
            }
            onChange(next);
          }}
        />
        <Button variant="ghost" size="icon-sm" aria-label="Remove argument" onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </div>
      {arg.type === "enum" ? (
        <Input
          value={(arg.enum ?? []).join(", ")}
          placeholder="value1, value2"
          onChange={(event) =>
            onChange({
              ...arg,
              enum: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
            })
          }
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        {arg.type === "boolean" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Default
            <Switch checked={arg.default === true} onChange={(checked) => onChange({ ...arg, default: checked })} />
          </label>
        ) : (
          <Input
            value={arg.default === undefined ? "" : String(arg.default)}
            placeholder="default (optional)"
            className="flex-1 text-ui-sm"
            onChange={(event) => {
              const raw = event.target.value;
              const value: WorkflowArgSpec = { ...arg };
              if (raw === "") {
                delete value.default;
              } else {
                value.default = arg.type === "number" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
              }
              onChange(value);
            }}
          />
        )}
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          Required
          <Switch checked={arg.required} onChange={(checked) => onChange({ ...arg, required: checked })} />
        </label>
      </div>
    </div>
  );
}

export function WorkflowSetupCard({ setup, args, agents, onSetupChange, onArgsChange }: WorkflowSetupCardProps) {
  const [expanded, setExpanded] = useState(false);

  const modelGroups: AgentHarnessModelGroup[] = agents.map((agent) => ({
    agentKind: agent.kind,
    agentDisplayName: agent.displayName,
    models: agent.models.map((model) => ({ id: model.id, label: model.label, detail: agent.displayName })),
  }));

  const updateArg = (index: number, next: WorkflowArgSpec) => {
    onArgsChange(args.map((arg, i) => (i === index ? next : arg)));
  };

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors hover:bg-list-hover"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-ui-sm font-medium text-foreground">Setup</span>
          <span className="truncate text-xs text-muted-foreground">{summaryText(setup, agents, args.length)}</span>
        </span>
        {expanded ? <ChevronDown className="size-4 shrink-0 text-faint" /> : <ChevronRight className="size-4 shrink-0 text-faint" />}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-4 border-t border-border/60 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label>Agent</Label>
            <AgentHarnessModelSelector
              label="Agent"
              agentKind={setup.harness || null}
              selectedModelId={setup.model || null}
              modelGroups={modelGroups}
              className="max-w-full"
              menuClassName="w-72"
              onSelectModel={(harness, model) => onSetupChange({ ...setup, harness, model })}
            />
            <p className="text-xs text-faint">Workflow runs use the agent's bypass mode.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Session</Label>
            <WorkflowSelect
              ariaLabel="Session"
              value={setup.sessionBinding}
              options={[
                { value: "fresh", label: "Fresh (visible)" },
                { value: "headless", label: "Headless" },
              ]}
              onChange={(value) =>
                onSetupChange({ ...setup, sessionBinding: value as WorkflowSessionBinding })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Target</Label>
            <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-faint">
              Run location is chosen when you run (this Mac or cloud). MCP/integration access inherits the target.
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Arguments</Label>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onArgsChange([...args, { name: "", type: "string", required: false }])}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {args.length === 0 ? (
              <p className="text-xs text-faint">
                No arguments. Add one to prompt for input on each run and use {"{{args.name}}"} in steps.
              </p>
            ) : (
              args.map((arg, index) => (
                <ArgRow
                  key={index}
                  arg={arg}
                  onChange={(next) => updateArg(index, next)}
                  onRemove={() => onArgsChange(args.filter((_, i) => i !== index))}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
