import type { WorkflowOnFail, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import { WorkflowStepCard } from "@proliferate/product-ui/workflows/WorkflowStepCard";
import { Button } from "@proliferate/ui/primitives/Button";
import { MoreHorizontal } from "@proliferate/ui/icons";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { WorkflowSelect } from "./WorkflowSelect";

type OnFailValue = "stop" | "retry" | "continue";

function toOnFail(value: OnFailValue): WorkflowOnFail {
  return value === "retry" ? { kind: "retry", n: 1 } : { kind: value };
}

const ON_FAIL_OPTIONS = [
  { value: "stop", label: "Stop", triggerLabel: "Stop on fail" },
  { value: "retry", label: "Retry ×1", triggerLabel: "Retry ×1 on fail" },
  { value: "continue", label: "Continue", triggerLabel: "Continue on fail" },
];

export interface WorkflowStepRailCardProps {
  step: WorkflowStep;
  index: number;
  selected: boolean;
  invalid: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onChange: (step: WorkflowStep) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/** A rail step card: the shared card + an on-fail popover chip and a kebab menu. */
export function WorkflowStepRailCard({
  step,
  index,
  selected,
  invalid,
  canMoveUp,
  canMoveDown,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: WorkflowStepRailCardProps) {
  const onFailControl = (
    <WorkflowSelect
      variant="chip"
      ariaLabel="On fail"
      value={step.onFail.kind}
      options={ON_FAIL_OPTIONS}
      align="end"
      menuWidthClassName="w-44"
      onChange={(value) => onChange({ ...step, onFail: toOnFail(value as OnFailValue) })}
    />
  );

  const menu = (
    <PopoverButton
      stopPropagation
      align="end"
      side="bottom"
      className={`w-40 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <Button variant="ghost" size="icon-sm" aria-label="Step options">
          <MoreHorizontal className="size-4" />
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1">
          <PopoverMenuItem
            density="compact"
            label="Duplicate"
            onClick={() => { close(); onDuplicate(); }}
          />
          <PopoverMenuItem
            density="compact"
            label="Move up"
            disabled={!canMoveUp}
            onClick={() => { close(); onMoveUp(); }}
          />
          <PopoverMenuItem
            density="compact"
            label="Move down"
            disabled={!canMoveDown}
            onClick={() => { close(); onMoveDown(); }}
          />
          <PopoverMenuItem
            density="compact"
            label="Delete"
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
            onClick={() => { close(); onDelete(); }}
          />
        </div>
      )}
    </PopoverButton>
  );

  return (
    <WorkflowStepCard
      step={step}
      index={index}
      selected={selected}
      invalid={invalid}
      onSelect={onSelect}
      dragHandle={<span className="cursor-grab select-none font-mono text-xs leading-none" aria-hidden>⠿</span>}
      menu={menu}
      onFailControl={onFailControl}
    />
  );
}
