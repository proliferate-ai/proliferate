import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Checkbox } from "@proliferate/ui/kit/Checkbox";
import { Check, ChevronDown, Play } from "@proliferate/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import type { MockBlocker, MockDefinition, MockInput, MockInputType, MockScenario } from "./fixtures";
import { GHOST_FIELD } from "./atoms";
import { TOKEN_PATTERN } from "./MockPromptDocument";

/**
 * The signature bar: parameters derived from the document plus declared
 * inputs, each as `name: value`. Type/required live behind the name. Running
 * is filling the signature — the action sits at the end of it.
 */

export type ArgValues = Record<string, string | boolean>;

export interface MockParam extends MockInput {
  referenced: boolean;
  declared: boolean;
}

export function collectParams(definition: MockDefinition): MockParam[] {
  const referenced = new Set<string>();
  for (const stage of definition.stages) {
    for (const step of stage.steps) {
      for (const match of step.prompt.matchAll(TOKEN_PATTERN)) referenced.add(match[1]!);
      if (step.goal) {
        for (const match of step.goal.objective.matchAll(TOKEN_PATTERN)) referenced.add(match[1]!);
      }
    }
  }
  const params: MockParam[] = definition.inputs.map((input) => ({
    ...input,
    referenced: referenced.has(input.name),
    declared: true,
  }));
  for (const name of referenced) {
    if (!params.some((p) => p.name === name)) {
      params.push({
        name,
        type: "string",
        required: false,
        referencedByPrompt: true,
        referenced: true,
        declared: false,
      });
    }
  }
  return params;
}

const SAFE_MAX = 9007199254740991;

export function paramError(param: MockParam, value: string | boolean): string | null {
  if (param.type === "boolean") return null;
  const text = String(value).trim();
  if (!text) return param.required || param.referenced ? "required" : null;
  if (param.type === "number") {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return "not a number";
    if (Math.abs(parsed) > SAFE_MAX) return "outside safe range";
  }
  return null;
}

export function seedArgs(definition: MockDefinition, preset: MockScenario["argPreset"]): ArgValues {
  const values: ArgValues = {};
  for (const input of definition.inputs) {
    if (input.type === "boolean") {
      values[input.name] = preset === "valid";
      continue;
    }
    if (preset === "empty") {
      values[input.name] = "";
    } else if (preset === "invalid") {
      values[input.name] =
        input.type === "number" ? "9007199254740993" : input.required ? "" : "high";
    } else {
      values[input.name] =
        input.type === "number" ? "40" : input.name === "issue_id" ? "PROLIF-2201" : "high";
    }
  }
  return values;
}

function ParamNameMenu({
  param,
  onPatch,
  onRemove,
}: {
  param: MockParam;
  onPatch: (patch: Partial<MockInput>) => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group/name flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-xs text-foreground transition-colors hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05]"
        >
          {param.name}
          <ChevronDown className="size-2.5 text-faint opacity-0 transition-opacity group-hover/name:opacity-100 data-[state=open]:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(["string", "number", "boolean"] as MockInputType[]).map((type) => (
          <DropdownMenuItem key={type} onSelect={() => onPatch({ type })}>
            <span className="flex w-4 items-center">
              {param.type === type ? <Check className="size-3" /> : null}
            </span>
            {type}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onPatch({ required: !param.required })}>
          <span className="flex w-4 items-center">
            {param.required ? <Check className="size-3" /> : null}
          </span>
          Required
        </DropdownMenuItem>
        {param.declared && !param.referenced ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <span className="w-4" />
              Remove input
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MockRunBar({
  definition,
  params,
  values,
  showErrors,
  blockers,
  onChangeDefinition,
  onChangeValue,
  onRun,
}: {
  definition: MockDefinition;
  params: MockParam[];
  values: ArgValues;
  showErrors: boolean;
  blockers: MockBlocker[];
  onChangeDefinition: (next: MockDefinition) => void;
  onChangeValue: (name: string, value: string | boolean) => void;
  onRun: () => void;
}) {
  function patchParam(param: MockParam, patch: Partial<MockInput>) {
    const exists = definition.inputs.some((i) => i.name === param.name);
    const inputs = exists
      ? definition.inputs.map((i) => (i.name === param.name ? { ...i, ...patch } : i))
      : [
          ...definition.inputs,
          { name: param.name, type: param.type, required: param.required, referencedByPrompt: true, ...patch },
        ];
    onChangeDefinition({ ...definition, inputs });
  }

  const eligible = blockers.length === 0;

  return (
    <div className="flex flex-col">
      {params.map((param) => {
        const error = paramError(param, values[param.name] ?? "");
        const invalid = showErrors && error !== null;
        return (
          <div key={param.name} className="flex items-start gap-3 py-1">
            <span className="w-32 shrink-0 pt-0.5">
              <ParamNameMenu
                param={param}
                onPatch={(patch) => patchParam(param, patch)}
                onRemove={() =>
                  onChangeDefinition({
                    ...definition,
                    inputs: definition.inputs.filter((i) => i.name !== param.name),
                  })
                }
              />
            </span>
            <div className="flex w-64 flex-col gap-0.5">
              {param.type === "boolean" ? (
                <span className="flex h-7 items-center">
                  <Checkbox
                    checked={values[param.name] === true}
                    onCheckedChange={(next) => onChangeValue(param.name, next === true)}
                    aria-label={`Value for ${param.name}`}
                  />
                </span>
              ) : (
                <Input
                  value={String(values[param.name] ?? "")}
                  onChange={(e) => onChangeValue(param.name, e.target.value)}
                  aria-invalid={invalid || undefined}
                  aria-label={`Value for ${param.name}`}
                  className={twMerge(
                    GHOST_FIELD,
                    "h-7 rounded-none border-b border-b-border text-xs hover:border-x-transparent hover:border-t-transparent focus:border-x-transparent focus:border-t-transparent",
                    invalid ? "border-b-destructive/50" : "",
                  )}
                />
              )}
              {invalid ? (
                <span role="alert" className="text-xs text-destructive">
                  {error}
                </span>
              ) : null}
            </div>
            <span className="pt-1.5 text-xs text-faint">
              {param.type}
              {param.required ? " · required" : ""}
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-3">
        {eligible ? (
          <>
            <p className="text-xs text-faint">
              One immutable invocation, delivered with the same ID.
            </p>
            <Button size="sm" onClick={onRun}>
              <Play className="size-3.5" />
              Run in Cloud
            </Button>
          </>
        ) : (
          <span
            className="text-xs text-muted-foreground"
            title={blockers.map((b) => b.code).join(", ")}
          >
            Not runnable · {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
