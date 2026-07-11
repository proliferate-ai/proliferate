import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import { Input } from "@proliferate/ui/primitives/Input";
import { Switch } from "@proliferate/ui/primitives/Switch";
import type { ArgValue, TriggerDraft } from "@/hooks/workflows/workflows/use-workflow-trigger-drafts";
import { WorkflowSelect } from "../WorkflowSelect";

/** One trigger-draft argument row (preset value for a schedule/poll trigger) —
 * shared by both trigger kinds, addressed by the workflow input's declared
 * type. */
export function ScheduleArgRow({
  arg,
  draft,
  onPatch,
}: {
  arg: WorkflowInputSpec;
  draft: TriggerDraft;
  onPatch: (patch: Partial<TriggerDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-2">
      <span className="flex min-w-0 items-center gap-1 truncate font-mono text-sm text-foreground">
        {arg.name}
        {arg.required ? <span className="text-destructive">*</span> : null}
        <span className="font-sans text-xs text-faint">· {arg.type}</span>
      </span>
      <ArgValueInput arg={arg} value={draft.argValues[arg.name]} onChange={(value) => onPatch({ argValues: { ...draft.argValues, [arg.name]: value } })} />
    </div>
  );
}

function ArgValueInput({
  arg,
  value,
  onChange,
}: {
  arg: WorkflowInputSpec;
  value: ArgValue;
  onChange: (value: ArgValue) => void;
}) {
  if (arg.type === "boolean") {
    return (
      <div className="flex h-9 items-center">
        <Switch checked={Boolean(value)} onChange={(checked) => onChange(checked)} />
      </div>
    );
  }
  if (arg.type === "choice") {
    return (
      <WorkflowSelect
        ariaLabel={`${arg.name} value`}
        value={String(value ?? "")}
        options={(arg.choices ?? []).map((option) => ({ value: option, label: option }))}
        onChange={(next) => onChange(next)}
      />
    );
  }
  return (
    <Input
      type={arg.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      placeholder={arg.required ? "Required" : "Optional"}
    />
  );
}
