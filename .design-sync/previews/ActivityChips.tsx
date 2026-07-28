import { useEffect, useRef, type ReactNode } from "react";
import { ActivityChips, AgentsRosterPanel, TerminalsRosterPanel } from "@proliferate/ui";

const NOW_MS = 1_751_450_100_000;

const CHIPS_ALL = [
  { kind: "loops", count: 3, liveCount: 3, label: "3 loops" },
  { kind: "terminals", count: 3, liveCount: 1, label: "3 terminals" },
  { kind: "agents", count: 2, liveCount: 2, label: "2 native subagents" },
];

const CHIPS_TERMINALS_ONLY = [
  { kind: "terminals", count: 1, liveCount: 1, label: "1 terminal" },
];

const AGENTS = [
  {
    id: "task-1",
    agentType: "general-purpose",
    description: "Audit the cloud-environment API surface",
    model: "claude-opus-4",
    background: true,
    status: { status: "running" },
    usage: null,
    feed: { feedId: "feed-task-1", kind: "transcript" },
  },
  {
    id: "task-2",
    agentType: "general-purpose",
    description: "Docs pass over the new auth flow",
    model: "claude-sonnet-4",
    background: false,
    status: { status: "running" },
    usage: { tokensUsed: 41_200, toolCalls: 18, durationSeconds: 210 },
    feed: { feedId: "feed-task-2", kind: "transcript" },
  },
];

const PROCESSES = [
  {
    id: "proc-1",
    command: "pnpm -F @proliferate/product-ui build --watch",
    cwd: "~/proliferate",
    status: { status: "running" },
    pid: 48_213,
    startedAt: "2026-07-02T10:10:00.000Z",
    endedAt: null,
    feed: { feedId: "feed-proc-1", kind: "terminal_bytes" },
  },
  {
    id: "proc-2",
    command: "cargo test -p anyharness",
    cwd: "~/proliferate",
    status: { status: "exited", exitCode: 0 },
    pid: null,
    startedAt: "2026-07-02T10:05:00.000Z",
    endedAt: "2026-07-02T10:07:30.000Z",
    feed: { feedId: "feed-proc-2", kind: "terminal_bytes" },
  },
];

/** The chips-only bar shell GoalBar renders when a session has activity but no goal. */
const ChipsBar = ({ children }: { children: ReactNode }) => (
  <div className="flex w-full max-w-2xl items-center justify-between gap-3 rounded-xl bg-composer-background px-3 py-2 shadow-popover ring-[0.5px] ring-border">
    <span className="min-w-0 truncate text-ui text-muted-foreground">
      proliferate-ai/proliferate · claude/design-sync-ui-import
    </span>
    {children}
  </div>
);

/** Opens the last chip's popover so the click-in panel photographs. */
const OpenLastChipOnMount = ({ children }: { children: ReactNode }) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const buttons = host.current?.querySelectorAll("button");
      if (buttons && buttons.length > 0) {
        (buttons[buttons.length - 1] as HTMLButtonElement).click();
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);
  return <div ref={host}>{children}</div>;
};

export const SummaryRow = () => (
  <ChipsBar>
    <ActivityChips chips={CHIPS_ALL} />
  </ChipsBar>
);

export const SingleKind = () => (
  <ChipsBar>
    <ActivityChips chips={CHIPS_TERMINALS_ONLY} />
  </ChipsBar>
);

export const ClickableChips = () => (
  <ChipsBar>
    <ActivityChips
      chips={CHIPS_ALL}
      panels={{
        terminals: <TerminalsRosterPanel processes={PROCESSES} nowMs={NOW_MS} />,
        agents: <AgentsRosterPanel agents={AGENTS} nowMs={NOW_MS} />,
      }}
    />
  </ChipsBar>
);

export const AgentsPanelOpen = () => (
  <div className="flex w-full items-end justify-center" style={{ height: 400 }}>
    <OpenLastChipOnMount>
      <ChipsBar>
        <ActivityChips
          chips={CHIPS_ALL}
          panels={{
            terminals: <TerminalsRosterPanel processes={PROCESSES} nowMs={NOW_MS} />,
            agents: <AgentsRosterPanel agents={AGENTS} nowMs={NOW_MS} />,
          }}
        />
      </ChipsBar>
    </OpenLastChipOnMount>
  </div>
);
