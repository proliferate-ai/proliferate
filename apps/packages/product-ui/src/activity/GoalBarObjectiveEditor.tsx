import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { GoalBarIconAction } from "./GoalBarIconAction";

interface GoalBarObjectiveEditorProps {
  initialValue: string;
  placeholder: string;
  onCommit: (objective: string) => void;
  onCancel: () => void;
}

// Conductor reference: a tall auto-growing textarea (≈3 rows minimum, grows
// with content up to a cap before it scrolls internally) with ✓/✗ icon
// buttons pinned to the top-right corner.
const MIN_ROWS = 3;
const MAX_HEIGHT_PX = 240;

/**
 * The goal editor: a multi-line, auto-growing textarea used both for
 * editing an existing goal in place and for the empty-state "set a new
 * goal" composer. Cmd/Ctrl+Enter commits the trimmed objective, Escape
 * cancels, and plain Enter inserts a newline (native textarea behavior).
 * Committing does not update the displayed goal — the mirror only moves
 * when the native notification round-trips.
 */
export function GoalBarObjectiveEditor({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
}: GoalBarObjectiveEditorProps) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter"
      && (event.metaKey || event.ctrlKey)
      && !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
    // Plain Enter falls through to the textarea's native newline insertion.
  };

  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        ref={textareaRef}
        variant="ghost"
        autoFocus
        rows={MIN_ROWS}
        value={value}
        placeholder={placeholder}
        aria-label="Goal objective"
        data-telemetry-mask
        className="min-h-0 resize-none overflow-y-auto whitespace-pre-wrap break-words bg-transparent pr-14 text-ui leading-[1.5] text-foreground placeholder:text-muted-foreground focus:outline-none"
        style={{ maxHeight: MAX_HEIGHT_PX }}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="absolute right-0 top-0 flex shrink-0 items-center gap-0.5">
        <GoalBarIconAction label="Cancel" icon={<X className="size-3.5" />} onClick={onCancel} />
        <GoalBarIconAction
          label="Save goal"
          icon={<Check className="size-3.5" />}
          positive
          onClick={commit}
        />
      </span>
    </div>
  );
}
