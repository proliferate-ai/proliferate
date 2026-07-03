import { useState } from "react";
import type { WorkflowOnFail, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import { WorkflowStepCard } from "@proliferate/product-ui/workflows/WorkflowStepCard";
import { Select } from "@proliferate/ui/primitives/Select";
import { Button } from "@proliferate/ui/primitives/Button";
import { MoreHorizontal } from "@proliferate/ui/icons";

type OnFailValue = "stop" | "retry" | "continue";

function toOnFail(value: OnFailValue): WorkflowOnFail {
  return value === "retry" ? { kind: "retry", n: 1 } : { kind: value };
}

function stop(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

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

/** A rail step card: the shared card + an on-fail footer select and a kebab. */
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
  const [menuOpen, setMenuOpen] = useState(false);

  const footer = (
    <span onClick={stop} className="inline-flex items-center gap-1.5">
      <span className="text-xs text-faint">On fail</span>
      <Select
        value={step.onFail.kind}
        onChange={(event) => onChange({ ...step, onFail: toOnFail(event.target.value as OnFailValue) })}
        className="h-7 py-0 text-xs"
      >
        <option value="stop">Stop</option>
        <option value="retry">Retry ×1</option>
        <option value="continue">Continue</option>
      </Select>
    </span>
  );

  const menu = (
    <span onClick={stop} className="relative inline-flex">
      <Button variant="ghost" size="icon-sm" aria-label="Step options" onClick={() => setMenuOpen((v) => !v)}>
        <MoreHorizontal className="size-4" />
      </Button>
      {menuOpen ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="absolute right-0 top-7 z-20 w-36 rounded-md border border-border bg-background p-1 text-ui-sm shadow-md">
            <button type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-foreground/[0.05]" onClick={() => { setMenuOpen(false); onDuplicate(); }}>
              Duplicate
            </button>
            <button type="button" disabled={!canMoveUp} className="block w-full rounded px-2 py-1 text-left hover:bg-foreground/[0.05] disabled:opacity-40" onClick={() => { setMenuOpen(false); onMoveUp(); }}>
              Move up
            </button>
            <button type="button" disabled={!canMoveDown} className="block w-full rounded px-2 py-1 text-left hover:bg-foreground/[0.05] disabled:opacity-40" onClick={() => { setMenuOpen(false); onMoveDown(); }}>
              Move down
            </button>
            <button type="button" className="block w-full rounded px-2 py-1 text-left text-destructive hover:bg-destructive/10" onClick={() => { setMenuOpen(false); onDelete(); }}>
              Delete
            </button>
          </div>
        </>
      ) : null}
    </span>
  );

  return (
    <WorkflowStepCard
      step={step}
      index={index}
      selected={selected}
      invalid={invalid}
      onSelect={onSelect}
      dragHandle={<span className="cursor-grab select-none font-mono leading-none" aria-hidden>⠿</span>}
      menu={menu}
      footer={footer}
    />
  );
}
