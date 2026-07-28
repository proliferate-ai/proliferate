import type { ReactNode } from "react";
import { SubagentRosterRow } from "@proliferate/ui";

/** The fixture clock the product's own activity playground pins to. */
const NOW_MS = 1_751_450_100_000;

const RUNNING = {
  id: "task-1",
  agentType: "general-purpose",
  description: "API surface check",
  model: "claude-opus-4",
  background: true,
  status: { status: "running" },
  usage: null,
  feed: { feedId: "feed-task-1", kind: "transcript" },
};

const COMPLETED = {
  id: "task-2",
  agentType: "general-purpose",
  description: "Docs pass over the new auth flow",
  model: "claude-sonnet-4-6",
  background: false,
  status: {
    status: "completed",
    summary: "Updated 3 docs pages; flagged one stale diagram.",
  },
  usage: { tokensUsed: 41_200, toolCalls: 18, durationSeconds: 210 },
  feed: { feedId: "feed-task-2", kind: "transcript" },
};

const FAILED = {
  id: "task-3",
  agentType: "test-triage",
  description: "Flaky test triage",
  model: "claude-haiku-4-5",
  background: false,
  status: { status: "failed" },
  usage: { tokensUsed: 8_400, toolCalls: 5, durationSeconds: 40 },
  feed: null,
};

const UNTITLED = {
  id: "task-4",
  agentType: "cursor/task",
  description: null,
  model: null,
  background: true,
  status: { status: "running" },
  usage: null,
  feed: null,
};

/** The ⑂ chip's click-in panel is a narrow popover — bound the row the same way. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="w-96 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-popover">
      {children}
    </div>
  );
}

export const Running = () => (
  <Panel>
    <SubagentRosterRow subagent={RUNNING} nowMs={NOW_MS} />
  </Panel>
);

export const CompletedWithSummary = () => (
  <Panel>
    <SubagentRosterRow subagent={COMPLETED} nowMs={NOW_MS} />
  </Panel>
);

export const Failed = () => (
  <Panel>
    <SubagentRosterRow subagent={FAILED} nowMs={NOW_MS} />
  </Panel>
);

export const ClickableRoster = () => (
  <Panel>
    <div className="px-1 pb-1 pt-0.5 text-ui font-medium text-foreground">Agents</div>
    <ul className="flex flex-col gap-0.5">
      {[RUNNING, COMPLETED, FAILED, UNTITLED].map((subagent) => (
        <li key={subagent.id}>
          <SubagentRosterRow
            subagent={subagent}
            nowMs={NOW_MS}
            onOpen={() => undefined}
          />
        </li>
      ))}
    </ul>
  </Panel>
);
