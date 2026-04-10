import { useState } from "react";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";
import { CheckCircleFilled, Circle, ClipboardList, Spinner } from "@/components/ui/icons";
import type { PlanEntry } from "@anyharness/sdk";

interface TodoTrackerPanelProps {
  entries: PlanEntry[];
}

export function TodoTrackerPanel({ entries }: TodoTrackerPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const completedCount = entries.filter((e) => e.status === "completed").length;

  const header = (
    <div className="text-chat flex min-w-0 items-center gap-1.5 text-muted-foreground">
      <ClipboardList className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {completedCount} out of {entries.length} tasks completed
      </span>
    </div>
  );

  return (
    <ComposerAttachedPanel
      header={header}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
    >
      <div className="vertical-scroll-fade-mask max-h-40 space-y-2 overflow-y-auto p-2 [--edge-fade-distance:2rem]">
        {entries.map((entry, index) => (
          <TodoEntryRow
            key={index}
            index={index + 1}
            content={entry.content}
            status={entry.status}
          />
        ))}
      </div>
    </ComposerAttachedPanel>
  );
}

function TodoEntryRow({
  index,
  content,
  status,
}: {
  index: number;
  content: string;
  status: string;
}) {
  const isCompleted = status === "completed";
  return (
    <div className="flex items-start gap-2">
      <div className="flex shrink-0 items-start gap-0.5">
        <div className="flex h-3.5 w-[1.125rem] items-center justify-center overflow-hidden">
          <TodoStatusIcon status={status} />
        </div>
        <span
          className={`text-chat leading-4 ${
            isCompleted ? "text-muted-foreground/60" : ""
          }`}
        >
          {index}.
        </span>
      </div>
      <span
        className={`text-chat flex-1 leading-4 ${
          isCompleted ? "text-muted-foreground/60 line-through" : ""
        }`}
      >
        {content}
      </span>
    </div>
  );
}

function TodoStatusIcon({ status }: { status: string }) {
  if (status === "in_progress") {
    return <Spinner className="size-3.5" />;
  }
  if (status === "completed") {
    return <CheckCircleFilled className="h-[9px] w-[9px] shrink-0 text-foreground/70" />;
  }
  return <Circle className="h-[9px] w-[9px] shrink-0 text-muted-foreground" />;
}
