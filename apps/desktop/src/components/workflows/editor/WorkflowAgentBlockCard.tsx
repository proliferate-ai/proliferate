import type { ReactNode } from "react";
import type { WorkflowAgentNode, WorkflowStep, WorkflowStepKind } from "@proliferate/product-domain/workflows/definition";
import { WORKFLOW_STEP_META, workflowStepPreview } from "@proliferate/product-domain/workflows/presentation";
import { WorkflowStepKindBadge } from "@proliferate/product-ui/workflows/WorkflowStepKindBadge";
import { Button } from "@proliferate/ui/primitives/Button";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ArrowDown, ArrowUp, CircleAlert, MoreHorizontal, Pencil, Plus, Trash } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export interface WorkflowStepRowProps {
  step: WorkflowStep;
  selected: boolean;
  invalid: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** One single-line step row inside an agent block card (editor page of record):
 * kind icon + label-or-preview, kebab on hover; identifiers/bodies live in the
 * inspector, never on the skim row. */
export function WorkflowStepRow({
  step,
  selected,
  invalid,
  canMoveUp,
  canMoveDown,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: WorkflowStepRowProps) {
  const text = step.label?.trim() || workflowStepPreview(step);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={twMerge(
        "group relative flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
        selected ? "bg-surface-elevated-secondary/70" : "hover:bg-surface-elevated-secondary/35",
      )}
    >
      <span
        aria-hidden
        className="absolute -left-2 top-1/2 -translate-y-1/2 cursor-grab select-none font-mono text-xs leading-none text-faint opacity-0 transition-opacity group-hover:opacity-100"
      >
        ⠿
      </span>
      <WorkflowStepKindBadge kind={step.kind} iconOnly className="shrink-0 bg-transparent p-0" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" data-telemetry-mask>
        {text || <span className="text-faint">Untitled step</span>}
      </span>
      {invalid ? <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden /> : null}
      <PopoverButton
        stopPropagation
        align="end"
        side="bottom"
        className={`w-44 ${POPOVER_SURFACE_CLASS}`}
        trigger={(
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            aria-label="Step actions"
            className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-surface-elevated-secondary hover:text-muted-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        )}
      >
        {(close) => (
          <div className="p-1">
            <PopoverMenuItem density="compact" icon={<Pencil className="size-3.5" />} label="Edit" onClick={() => { close(); onSelect(); }} />
            <PopoverMenuItem density="compact" icon={<ArrowUp className="size-3.5" />} label="Move up" disabled={!canMoveUp} onClick={() => { close(); onMove(-1); }} />
            <PopoverMenuItem density="compact" icon={<ArrowDown className="size-3.5" />} label="Move down" disabled={!canMoveDown} onClick={() => { close(); onMove(1); }} />
            <PopoverMenuItem density="compact" label="Duplicate" onClick={() => { close(); onDuplicate(); }} />
            <PopoverMenuItem
              density="compact"
              icon={<Trash className="size-3.5" />}
              label="Delete step"
              labelClassName="text-destructive"
              iconClassName="text-destructive"
              onClick={() => { close(); onDelete(); }}
            />
          </div>
        )}
      </PopoverButton>
    </div>
  );
}

export function WorkflowAddStepButton({
  kinds,
  onAdd,
}: {
  kinds: readonly WorkflowStepKind[];
  onAdd: (kind: WorkflowStepKind) => void;
}) {
  return (
    <PopoverButton
      align="start"
      side="bottom"
      className={`w-56 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-faint transition-colors hover:bg-surface-elevated-secondary/40 hover:text-muted-foreground data-[state=open]:bg-surface-elevated-secondary/40 data-[state=open]:text-muted-foreground"
        >
          <Plus className="size-3" />
          Add step
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1">
          {kinds.map((kind) => (
            <PopoverMenuItem
              key={kind}
              density="compact"
              icon={<WorkflowStepKindBadge kind={kind} iconOnly className="bg-transparent p-0" />}
              label={(
                <span className="flex flex-col">
                  <span>{WORKFLOW_STEP_META[kind].label}</span>
                  <span className="text-xs text-muted-foreground">{WORKFLOW_STEP_META[kind].hint}</span>
                </span>
              )}
              onClick={() => { close(); onAdd(kind); }}
            />
          ))}
        </div>
      )}
    </PopoverButton>
  );
}

export interface WorkflowAgentBlockCardProps {
  node: WorkflowAgentNode;
  /** Catalog display label for the node's model id. */
  modelLabel: string;
  selected: boolean;
  invalid: boolean;
  onSelect: () => void;
  /** Kebab menu content for the header (agent actions), rendered as-is. */
  menu: ReactNode;
  children: ReactNode;
}

/** One agent as a bordered block card (editor page of record): a provider-icon
 * header (slot + model, click opens the agent inspector) with its step rows
 * nested in the card body. */
export function WorkflowAgentBlockCard({
  node,
  modelLabel,
  selected,
  invalid,
  onSelect,
  menu,
  children,
}: WorkflowAgentBlockCardProps) {
  return (
    <div
      className={twMerge(
        "flex min-w-0 flex-1 flex-col rounded-xl border bg-background shadow-sm transition-colors",
        selected ? "border-border-heavy" : "border-border hover:border-border-heavy",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={twMerge(
          "flex min-w-0 cursor-pointer items-center gap-2 rounded-t-xl border-b border-border px-3.5 py-2.5 transition-colors",
          selected ? "bg-surface-elevated-secondary/50" : "hover:bg-surface-elevated-secondary/30",
        )}
      >
        <ProviderIcon kind={node.harness || "claude"} className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-sm font-semibold text-foreground">{node.slot}</span>
        <span className="shrink-0 text-xs text-faint">{modelLabel}</span>
        {invalid ? <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden /> : null}
        <span className="min-w-0 flex-1" />
        {menu}
      </div>
      <div className="flex flex-col p-1.5">{children}</div>
    </div>
  );
}

/** The vertical connector between spine entries; a routed branch in the entry
 * above renders its taken/ending cases as a plain-English summary. */
export function WorkflowSpineConnector({ route }: { route?: { taken: string; others?: string } | null }) {
  return (
    <div className="flex flex-col items-center py-1">
      <span className="h-3 w-px bg-border-heavy" />
      {route ? (
        <span className="inline-flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
          <span className="font-mono text-foreground/80" data-telemetry-mask>{route.taken}</span>
          <span>continues below</span>
          {route.others ? <span className="text-faint">· {route.others}</span> : null}
        </span>
      ) : null}
      {route ? <span className="h-3 w-px bg-border-heavy" /> : null}
      <ArrowDown className="-mt-1 size-3 text-border-heavy" />
    </div>
  );
}
