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
import { ChevronDown, ChevronRight, Plus, Robot, X } from "@proliferate/ui/icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
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

/** Aligned columns shared by the arg table header and every arg row. */
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={arg.name}
          placeholder="name"
          aria-label="Argument name"
          className="min-w-0 flex-1 font-mono"
          onChange={(event) => onChange({ ...arg, name: event.target.value })}
        />
        <WorkflowSelect
          ariaLabel="Argument type"
          value={arg.type}
          className="w-24"
          menuWidthClassName="w-32"
          align="start"
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
        {arg.type === "boolean" ? (
          <div className="flex w-28 shrink-0 items-center">
            <Switch checked={arg.default === true} onChange={(checked) => onChange({ ...arg, default: checked })} />
          </div>
        ) : (
          <Input
            value={arg.default === undefined ? "" : String(arg.default)}
            placeholder="default"
            aria-label="Default value"
            className="w-28 shrink-0"
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
        <div className="flex w-14 shrink-0 justify-center">
          <Switch
            aria-label="Required"
            checked={arg.required}
            onChange={(checked) => onChange({ ...arg, required: checked })}
          />
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Remove argument" className="shrink-0" onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </div>
      {arg.type === "enum" ? (
        <Input
          value={(arg.enum ?? []).join(", ")}
          placeholder="value1, value2"
          aria-label="Enum values"
          className="font-mono"
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
    </div>
  );
}

/**
 * The Setup "Agent scope" rail card — renders as the position-0 card on the rail,
 * speaking the same visual language as WorkflowStepCard (numbered spine, outline
 * kind pill, roomy card, connector). This is the workflow's initial agent scope.
 */
export function WorkflowSetupAgentCard({
  setup,
  agents,
  selected = false,
  onSelect,
}: {
  setup: WorkflowSetup;
  agents: readonly EditorAgent[];
  selected?: boolean;
  onSelect?: () => void;
}) {
  const agent = agents.find((a) => a.kind === setup.harness);
  const harness = agent?.displayName ?? (setup.harness || "No agent");
  const model = agent?.models.find((m) => m.id === setup.model)?.label ?? setup.model;

  return (
    <div className="flex flex-col">
      <div className="mb-1.5 flex items-center gap-2 pl-9">
        <span className="font-mono text-[10px] leading-tight text-muted-foreground/70">
          {harness}{model ? ` · ${model}` : ""}
        </span>
      </div>
      <div className="flex gap-3.5">
        <div className="flex shrink-0 flex-col items-center">
          <span className="flex size-6 items-center justify-center rounded-full border border-border bg-surface-elevated-secondary font-mono text-xs leading-none tabular-nums text-muted-foreground">
            0
          </span>
          <span className="mt-1.5 w-px flex-1 bg-border" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 pb-4">
          <div
            className={twMerge(
              "group rounded-xl border p-4 shadow-sm transition-colors bg-background",
              selected
                ? "border-border-heavy ring-1 ring-border-heavy"
                : "border-border hover:border-border-heavy",
              onSelect ? "cursor-pointer" : "",
            )}
            onClick={onSelect}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onKeyDown={
              onSelect
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect();
                    }
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-2.5">
              <span className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-0.5 text-xs font-medium leading-none text-foreground">
                <Robot className="size-3.5 shrink-0 text-foreground" aria-hidden />
                <span>Agent</span>
              </span>
              <span className="flex-1" />
            </div>
            <p className="mt-3 text-sm text-foreground">
              {harness}{model ? ` · ${model}` : ""}
            </p>
            <p className="mt-2.5 text-xs leading-snug text-faint">
              starts the first session
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The Setup configuration card: session mode, arguments, bypass hint.
 * Visually consistent with the rail card language (rounded-xl, border, shadow-sm).
 */
export function WorkflowSetupCard({ setup, args, agents: _agents, onSetupChange, onArgsChange }: WorkflowSetupCardProps) {
  const [expanded, setExpanded] = useState(false);

  const updateArg = (index: number, next: WorkflowArgSpec) => {
    onArgsChange(args.map((arg, i) => (i === index ? next : arg)));
  };

  const sessionLabel = setup.sessionBinding === "headless" ? "Headless" : "Fresh (visible)";
  const summaryParts = [sessionLabel];
  if (args.length > 0) {
    summaryParts.push(`${args.length} ${args.length === 1 ? "arg" : "args"}`);
  }

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors hover:bg-list-hover"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">Configuration</span>
          <span className="truncate text-xs text-muted-foreground">{summaryParts.join(" · ")}</span>
        </span>
        {expanded ? <ChevronDown className="size-4 shrink-0 text-faint" /> : <ChevronRight className="size-4 shrink-0 text-faint" />}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-4 border-t border-border/60 px-4 py-4">
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
            <p className="text-xs text-faint">
              Workflow runs use the agent&apos;s bypass mode. Run location (this Mac or cloud) is chosen at run time.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="mb-0">Arguments</Label>
              <span className="text-xs text-faint">Prompted on each run · use {"{{args.name}}"} in steps</span>
            </div>

            {args.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-0.5 text-xs text-faint">
                  <span className="min-w-0 flex-1">Name</span>
                  <span className="w-24">Type</span>
                  <span className="w-28">Default</span>
                  <span className="w-14 text-center">Req</span>
                  <span className="w-7 shrink-0" />
                </div>
                {args.map((arg, index) => (
                  <ArgRow
                    key={index}
                    arg={arg}
                    onChange={(next) => updateArg(index, next)}
                    onRemove={() => onArgsChange(args.filter((_, i) => i !== index))}
                  />
                ))}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => onArgsChange([...args, { name: "", type: "string", required: false }])}
              className="flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add argument
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
