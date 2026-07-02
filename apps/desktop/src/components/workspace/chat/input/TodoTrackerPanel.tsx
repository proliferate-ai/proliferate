import { useEffect, useRef, useState } from "react";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";
import { ListChecks } from "lucide-react";
import { CheckCircleFilled, Circle, Spinner } from "@proliferate/ui/icons";
import type { PlanEntry } from "@anyharness/sdk";

interface TodoTrackerPanelProps {
  entries: PlanEntry[];
}

export function TodoTrackerPanel({ entries }: TodoTrackerPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const inProgressIndex = entries.findIndex((e) => e.status === "in_progress");
  const progress = entries.length > 0 ? completedCount / entries.length : 0;

  // Keep the active task on screen as the agent walks the list: whenever the
  // in-progress row moves, scroll it toward the center of the clamped list.
  useEffect(() => {
    if (!expanded || inProgressIndex < 0) {
      return;
    }
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[data-todo-status="in_progress"]');
    if (!list || !row || typeof list.scrollTo !== "function") {
      return;
    }
    const rowTop = row.offsetTop - list.offsetTop;
    const target = rowTop - (list.clientHeight - row.offsetHeight) / 2;
    list.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [expanded, inProgressIndex]);

  // Hairline progress affordance: a 2px rounded track whose fill is
  // transform-scaled (compositor-only — never width-animated). It lives in
  // the header context slot so progress stays visible while collapsed.
  const context = (
    <span className="flex items-center gap-2">
      <span className="h-0.5 w-10 shrink-0 overflow-hidden rounded-full bg-foreground/10">
        <span
          data-todo-progress
          className="block h-full w-full origin-left rounded-full bg-foreground/40 transition-transform duration-500 ease-out"
          style={{ transform: `scaleX(${progress})` }}
        />
      </span>
      <span className="tabular-nums">
        {completedCount} of {entries.length} done
      </span>
    </span>
  );

  return (
    <ComposerAttachedPanel
      icon={<ListChecks />}
      title="Tasks"
      context={context}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
      toggleOnHeaderClick
    >
      <div
        ref={listRef}
        className="vertical-scroll-fade-mask max-h-40 overflow-y-auto pb-2 [--edge-fade-distance:2rem]"
      >
        {entries.map((entry, index) => (
          <TodoEntryRow key={index} content={entry.content} status={entry.status} />
        ))}
      </div>
    </ComposerAttachedPanel>
  );
}

// Focus hierarchy per state: the in-flight task reads at full ink, queued
// tasks recede, finished tasks strike through and fade.
const STATUS_TEXT_CLASSNAME: Record<string, string> = {
  in_progress: "text-foreground",
  completed: "text-muted-foreground/60 line-through",
};

function TodoEntryRow({ content, status }: { content: string; status: string }) {
  return (
    <div data-todo-status={status} className="flex items-start gap-1.5 px-3 py-1.5">
      {/* Icon box spans the first text line so wrapped rows stay aligned;
          its 16px width lines the icons up under the header glyph. */}
      <span className="flex h-[var(--text-ui--line-height)] w-4 shrink-0 items-center justify-center">
        <TodoStatusIcon status={status} />
      </span>
      <span
        className={`text-ui min-w-0 flex-1 ${STATUS_TEXT_CLASSNAME[status] ?? "text-muted-foreground"}`}
      >
        {content}
      </span>
    </div>
  );
}

// Uniform 14px state icons on one grid line: hollow circle (queued), app
// Spinner in the --special accent (in flight), filled check (done).
function TodoStatusIcon({ status }: { status: string }) {
  if (status === "in_progress") {
    return <Spinner className="size-3.5 shrink-0 text-special" />;
  }
  if (status === "completed") {
    return <CheckCircleFilled className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <Circle className="size-3.5 shrink-0 text-faint" />;
}

/**
 * Slim one-line fallback rendered directly below an interaction card when a
 * permission/question takes the dock's active slot: plan progress stays
 * visible ("3/7" + the in-flight task) instead of being evicted with the
 * full tracker panel. Same icon/color language as the panel rows.
 */
export function TodoTrackerStrip({ entries }: TodoTrackerPanelProps) {
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const currentTask = entries.find((e) => e.status === "in_progress") ?? null;

  return (
    <div
      data-todo-tracker-strip
      className="flex min-w-0 items-center gap-1.5 border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))] px-3 py-1.5 text-ui-sm text-muted-foreground"
    >
      <ListChecks className="size-3.5 shrink-0" />
      <span className="shrink-0 tabular-nums">
        {completedCount}/{entries.length}
      </span>
      {currentTask && (
        <>
          <Spinner className="ml-1 size-3.5 shrink-0 text-special" />
          <span className="min-w-0 truncate">{currentTask.content}</span>
        </>
      )}
    </div>
  );
}
