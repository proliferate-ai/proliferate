import type { ReactNode } from "react";
import type { PlanEntry } from "@anyharness/sdk";
import {
  TodoProgressChecklistCard,
  TodoProgressPillView,
} from "#product/components/workspace/chat/input/TodoProgressPill";
import { summarizeTodoProgress } from "#product/domain/chats/composer/todo-progress-summary";
import type { ScenarioKey } from "#product/config/playground";
import {
  TODOS_LONG,
  TODOS_MID,
  TODOS_SHORT,
} from "#product/lib/domain/chat/__fixtures__/playground/panel-todo-fixtures";

/**
 * `ChatComposerDock`'s `floatingSlot` — the transient pill that replaced
 * `TodoTrackerPanel`. The connected `TodoProgressPill` is timer-driven and
 * only appears on a live step advance, so playground scenarios render it
 * pinned open (pill + checklist together) from the pure pieces instead —
 * that's the only way to see the checklist card in a static screenshot.
 */
export function renderFloatingSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "todos-short":
      return <TodoProgressPillFixture entries={TODOS_SHORT} />;
    case "todos-mid":
      return <TodoProgressPillFixture entries={TODOS_MID} />;
    case "todos-long":
      return <TodoProgressPillFixture entries={TODOS_LONG} />;
    default:
      return null;
  }
}

function TodoProgressPillFixture({ entries }: { entries: PlanEntry[] }) {
  const summary = summarizeTodoProgress(entries);
  if (!summary) {
    return null;
  }
  return (
    <div className="pointer-events-none flex flex-col items-center gap-2">
      <TodoProgressChecklistCard entries={entries} />
      <TodoProgressPillView label={summary.label} faded={false} animateFade={false} />
    </div>
  );
}
