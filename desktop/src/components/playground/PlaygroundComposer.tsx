import { type ReactNode } from "react";
import { ApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { ChatComposerSurface } from "@/components/workspace/chat/input/ChatComposerSurface";
import { PendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { ArrowUp } from "@/components/ui/icons";
import type { ScenarioKey } from "@/config/playground";
import {
  EDIT_OPTIONS,
  EXECUTE_OPTIONS,
  PENDING_PROMPTS_MULTI,
  PENDING_PROMPTS_SINGLE,
  PENDING_PROMPTS_WITH_EDITING,
  PLAN_OPTIONS,
  TODOS_LONG,
  TODOS_MID,
  TODOS_SHORT,
} from "@/lib/domain/chat/__fixtures__/playground";

interface PlaygroundComposerProps {
  scenario: ScenarioKey;
}

const noop = () => {};

export function PlaygroundComposer({ scenario }: PlaygroundComposerProps) {
  if (scenario === "cowork-pending") {
    return (
      <div className="px-4 pb-4">
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Composer hidden while creating a Cowork thread.
        </div>
      </div>
    );
  }

  const topSlot = renderTopSlot(scenario);
  return (
    <ChatComposerDock topSlot={topSlot ?? undefined}>
      <PlaygroundComposerSurface />
    </ChatComposerDock>
  );
}

function renderTopSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "clean":
    case "cowork-clean":
    case "cowork-pending":
      return null;
    case "todos-short":
      return <TodoTrackerPanel entries={TODOS_SHORT} />;
    case "todos-mid":
      return <TodoTrackerPanel entries={TODOS_MID} />;
    case "todos-long":
      return <TodoTrackerPanel entries={TODOS_LONG} />;
    case "execute-approval":
      return (
        <ApprovalCard
          title="git push origin main"
          actions={EXECUTE_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "edit-approval":
      return (
        <ApprovalCard
          title="Edit desktop/src/components/workspace/chat/input/ApprovalCard.tsx"
          actions={EDIT_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "claude-plan-short":
    case "claude-plan-long":
      return (
        <ApprovalCard
          title="Ready to code?"
          actions={PLAN_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "pending-prompts-single":
      return (
        <PendingPromptList
          entries={PENDING_PROMPTS_SINGLE}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-multi":
      return (
        <PendingPromptList
          entries={PENDING_PROMPTS_MULTI}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-editing":
      return (
        <PendingPromptList
          entries={PENDING_PROMPTS_WITH_EDITING}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-with-approval":
      return (
        <>
          <div className="mx-8 flex flex-col">
            <ApprovalCard
              title="wc -l /Users/pablo/proliferate/server/proliferate/**/*.py | tail -1"
              actions={EXECUTE_OPTIONS}
              onSelectOption={noop}
              onAllow={noop}
              onDeny={noop}
            />
          </div>
          <PendingPromptList
            entries={PENDING_PROMPTS_SINGLE}
            onBeginEdit={noop}
            onDelete={noop}
          />
        </>
      );
  }
}

function PlaygroundComposerSurface() {
  return (
    <ChatComposerSurface>
      <form className="relative flex flex-col">
        <div
          className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
          style={{ minHeight: "3.5rem" }}
        >
          <Textarea
            variant="ghost"
            rows={2}
            placeholder="Playground composer (read-only)"
            spellCheck={false}
            readOnly
            className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center justify-end gap-1 px-2 pb-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            disabled
            aria-label="Send (playground — disabled)"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </form>
    </ChatComposerSurface>
  );
}
