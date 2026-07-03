import { useState } from "react";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { Button } from "@proliferate/ui/primitives/Button";
import { Plus } from "@proliferate/ui/icons";

/**
 * Triggers card (spec 3.6). Manual is always-on and the only live trigger in
 * v1; schedule/webhook/API render as disabled "soon". The concurrency toggle is
 * UI-only in W6 (it belongs to the trigger/automation record, wired in W5).
 */
export function WorkflowTriggersCard() {
  const [concurrency, setConcurrency] = useState<"skip" | "queue">("skip");

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4">
      <span className="text-ui-sm font-medium text-foreground">Triggers</span>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent px-2.5 py-1 text-xs text-foreground">
          <span aria-hidden>▶</span> Manual
        </span>
        <Button variant="secondary" size="sm" disabled title="Scheduling arrives in W5">
          <Plus className="size-3.5" />
          Add schedule · soon
        </Button>
        <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
          Webhook · soon
        </span>
        <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
          API · soon
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">If still running when triggered again</Label>
        <Select
          value={concurrency}
          className="w-40"
          onChange={(event) => setConcurrency(event.target.value as "skip" | "queue")}
        >
          <option value="skip">Skip</option>
          <option value="queue">Queue</option>
        </Select>
      </div>
    </div>
  );
}
