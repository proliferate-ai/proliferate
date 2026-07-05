import { Button } from "@proliferate/ui/primitives/Button";
import { MoreHorizontal, Robot } from "@proliferate/ui/icons";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

/**
 * The scope-boundary header for an agent configuration.
 *
 * Agent config is NOT an action in the sequence — it declares "everything below
 * runs as <harness · model>". So it renders as a slim, full-width divider row
 * (a section boundary) rather than a numbered card-in-the-spine. It carries no
 * spine number.
 *
 * Variants:
 * - `initial`      — the workflow's first scope (from Setup). Sits at the top of
 *                    the action list; reads "starts the first session".
 * - `new-session`  — a harness change. The strongest divider treatment; folds in
 *                    the old session-break connector ("new session").
 * - `model-only`   — a model-only change that continues the session. Quiet.
 */
export type WorkflowScopeVariant = "initial" | "new-session" | "model-only";

export interface WorkflowScopeHeaderProps {
  variant: WorkflowScopeVariant;
  /** Display harness label (e.g. "Claude Code" or "No agent"). */
  harness: string;
  /** Display model label. Empty when unset. */
  model: string;
  selected: boolean;
  invalid?: boolean;
  onSelect: () => void;
  /** Reorder / duplicate / delete controls — only for inline config headers. */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

const CAPTION: Record<WorkflowScopeVariant, string> = {
  initial: "starts the first session",
  "new-session": "new session",
  "model-only": "continues session",
};

export function WorkflowScopeHeader({
  variant,
  harness,
  model,
  selected,
  invalid = false,
  onSelect,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onDuplicate,
  onMoveDown,
  onDelete,
}: WorkflowScopeHeaderProps) {
  const strong = variant === "initial" || variant === "new-session";
  const hasMenu = Boolean(onDelete || onDuplicate || onMoveUp || onMoveDown);

  const menu = hasMenu ? (
    <PopoverButton
      stopPropagation
      align="end"
      side="bottom"
      className={`w-40 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <Button variant="ghost" size="icon-sm" aria-label="Scope options">
          <MoreHorizontal className="size-4" />
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1">
          {onDuplicate ? (
            <PopoverMenuItem density="compact" label="Duplicate" onClick={() => { close(); onDuplicate(); }} />
          ) : null}
          {onMoveUp ? (
            <PopoverMenuItem density="compact" label="Move up" disabled={!canMoveUp} onClick={() => { close(); onMoveUp(); }} />
          ) : null}
          {onMoveDown ? (
            <PopoverMenuItem density="compact" label="Move down" disabled={!canMoveDown} onClick={() => { close(); onMoveDown(); }} />
          ) : null}
          {onDelete ? (
            <PopoverMenuItem
              density="compact"
              label="Delete"
              className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
              onClick={() => { close(); onDelete(); }}
            />
          ) : null}
        </div>
      )}
    </PopoverButton>
  ) : null;

  return (
    <div className={twMerge("flex items-center gap-2", strong ? "py-2.5" : "py-1.5")}>
      <button
        type="button"
        onClick={onSelect}
        className={twMerge(
          "-ml-1.5 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left outline-none transition-colors hover:bg-list-hover",
          selected ? "bg-list-hover ring-1 ring-border-heavy" : "",
          invalid ? "ring-1 ring-destructive/60" : "",
        )}
        aria-label={`Agent scope · ${harness}${model ? ` · ${model}` : ""}`}
      >
        <span
          aria-hidden
          className={twMerge(
            "text-[9px] leading-none",
            strong ? "text-foreground" : "text-faint",
          )}
        >
          ◆
        </span>
        <span className="inline-flex shrink-0 select-none items-center gap-1.5 rounded-full border border-border bg-transparent px-2.5 py-0.5 text-xs font-medium leading-none text-foreground">
          <Robot className="size-3.5 shrink-0 text-foreground" aria-hidden />
          <span>Agent</span>
        </span>
        <span className="truncate font-mono text-[11px] leading-none text-muted-foreground">
          {harness}{model ? ` · ${model}` : ""}
        </span>
        <span
          className={twMerge(
            "shrink-0 whitespace-nowrap font-mono text-[10px] leading-none",
            strong ? "text-muted-foreground" : "text-faint",
          )}
        >
          · {CAPTION[variant]}
        </span>
      </button>
      <span
        aria-hidden
        className={twMerge(
          "h-px flex-1",
          variant === "new-session" ? "bg-border-heavy" : "bg-border",
        )}
      />
      {menu ? <span className="shrink-0">{menu}</span> : null}
    </div>
  );
}
