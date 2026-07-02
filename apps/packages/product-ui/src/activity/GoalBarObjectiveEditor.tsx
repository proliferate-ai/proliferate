import { useState, type KeyboardEvent } from "react";
import { Input } from "@proliferate/ui/primitives/Input";

interface GoalBarObjectiveEditorProps {
  initialValue: string;
  placeholder: string;
  onCommit: (objective: string) => void;
  onCancel: () => void;
}

/**
 * The in-place goal editor: the bar row swaps to a bare input. Enter commits
 * the trimmed objective, Escape cancels. Committing does not update the
 * displayed goal — the mirror only moves when the native notification
 * round-trips.
 */
export function GoalBarObjectiveEditor({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
}: GoalBarObjectiveEditorProps) {
  const [value, setValue] = useState(initialValue);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        onCancel();
        return;
      }
      onCommit(trimmed);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <>
      <Input
        variant="unstyled"
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label="Goal objective"
        data-telemetry-mask
        className="h-6 min-w-0 flex-1 bg-transparent text-ui text-foreground placeholder:text-muted-foreground focus:outline-none"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
      />
      <span className="shrink-0 pr-1.5 text-ui-sm text-faint">
        Enter to save · Esc to cancel
      </span>
    </>
  );
}
