import type { ReactNode } from "react";
import { TerminalRosterRow } from "@proliferate/ui";

/** The fixture clock the product's own activity playground pins to. */
const NOW_MS = 1_751_450_100_000;

const RUNNING = {
  id: "proc-1",
  command: "sleep 30 && echo OK > out.txt",
  cwd: "~/src/anyharness",
  status: { status: "running" },
  pid: null,
  startedAt: "2026-07-02T10:10:00.000Z",
  endedAt: null,
  feed: { feedId: "feed-proc-1", kind: "terminal_bytes" },
};

const FINISHED = {
  id: "proc-2",
  command: "pnpm -F @proliferate/product-ui build",
  cwd: "~/src/anyharness",
  status: { status: "exited", exitCode: 0 },
  pid: 41_902,
  startedAt: "2026-07-02T10:05:00.000Z",
  endedAt: "2026-07-02T10:07:30.000Z",
  feed: { feedId: "feed-proc-2", kind: "terminal_bytes" },
};

const FAILED = {
  id: "proc-3",
  command: "pytest tests/live_sessions -x",
  cwd: "~/src/anyharness/server",
  status: { status: "exited", exitCode: 1 },
  pid: 48_213,
  startedAt: "2026-07-02T10:00:00.000Z",
  endedAt: "2026-07-02T10:01:12.000Z",
  feed: { feedId: "feed-proc-3", kind: "terminal_bytes" },
};

const KILLED = {
  id: "proc-4",
  command: "cargo watch -x 'test --workspace'",
  cwd: null,
  status: { status: "exited", exitCode: null },
  pid: null,
  startedAt: "2026-07-02T09:44:00.000Z",
  endedAt: "2026-07-02T09:58:20.000Z",
  feed: null,
};

/** The ▸ chip's click-in panel is a narrow popover — bound the row the same way. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="w-96 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-popover">
      {children}
    </div>
  );
}

export const Running = () => (
  <Panel>
    <TerminalRosterRow process={RUNNING} nowMs={NOW_MS} />
  </Panel>
);

export const Finished = () => (
  <Panel>
    <TerminalRosterRow process={FINISHED} nowMs={NOW_MS} />
  </Panel>
);

export const ExitedWithError = () => (
  <Panel>
    <TerminalRosterRow process={FAILED} nowMs={NOW_MS} />
  </Panel>
);

export const ClickableRoster = () => (
  <Panel>
    <div className="px-1 pb-1 pt-0.5 text-ui font-medium text-foreground">Terminals</div>
    <ul className="flex flex-col gap-0.5">
      {[RUNNING, FINISHED, FAILED, KILLED].map((process) => (
        <li key={process.id}>
          <TerminalRosterRow
            process={process}
            nowMs={NOW_MS}
            onOpen={() => undefined}
          />
        </li>
      ))}
    </ul>
  </Panel>
);
