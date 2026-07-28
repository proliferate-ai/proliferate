import type { ReactNode } from "react";
import { TerminalsRosterPanel } from "@proliferate/ui";

/** The fixture clock the product's own activity playground pins to. */
const NOW_MS = 1_751_450_100_000;

const PROCESS_RUNNING = {
  id: "proc-1",
  command: "sleep 30 && echo OK > out.txt",
  cwd: "~/src/anyharness",
  status: { status: "running" },
  pid: null,
  startedAt: "2026-07-02T10:10:00.000Z",
  endedAt: null,
  feed: { feedId: "feed-proc-1", kind: "terminal_bytes" },
};

const PROCESS_DEV_SERVER = {
  id: "proc-5",
  command: "pnpm dev --filter @proliferate/web",
  cwd: "~/src/anyharness/apps/web",
  status: { status: "running" },
  pid: 51_004,
  startedAt: "2026-07-02T09:52:00.000Z",
  endedAt: null,
  feed: { feedId: "feed-proc-5", kind: "terminal_bytes" },
};

const PROCESS_EXITED_SUCCESS = {
  id: "proc-2",
  command: "pnpm -F @proliferate/product-ui build",
  cwd: "~/src/anyharness",
  status: { status: "exited", exitCode: 0 },
  pid: 41_902,
  startedAt: "2026-07-02T10:05:00.000Z",
  endedAt: "2026-07-02T10:07:30.000Z",
  feed: { feedId: "feed-proc-2", kind: "terminal_bytes" },
};

const PROCESS_EXITED_FAILURE = {
  id: "proc-3",
  command: "pytest tests/live_sessions -x",
  cwd: "~/src/anyharness/server",
  status: { status: "exited", exitCode: 1 },
  pid: 48_213,
  startedAt: "2026-07-02T10:00:00.000Z",
  endedAt: "2026-07-02T10:01:12.000Z",
  feed: { feedId: "feed-proc-3", kind: "terminal_bytes" },
};

/**
 * The panel is the ▸ activity chip's click-in surface — it has no chrome of its
 * own, so each cell supplies the popover the chip anchors.
 */
function Popover({ children }: { children: ReactNode }) {
  return (
    <div className="w-96 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-popover">
      {children}
    </div>
  );
}

export const MixedProcesses = () => (
  <Popover>
    <TerminalsRosterPanel
      processes={[
        PROCESS_EXITED_SUCCESS,
        PROCESS_RUNNING,
        PROCESS_EXITED_FAILURE,
        PROCESS_DEV_SERVER,
      ]}
      nowMs={NOW_MS}
    />
  </Popover>
);

export const SingleRunning = () => (
  <Popover>
    <TerminalsRosterPanel processes={[PROCESS_RUNNING]} nowMs={NOW_MS} />
  </Popover>
);

export const Clickable = () => (
  <Popover>
    <TerminalsRosterPanel
      processes={[PROCESS_DEV_SERVER, PROCESS_EXITED_FAILURE]}
      nowMs={NOW_MS}
      onOpen={() => undefined}
    />
  </Popover>
);

export const Empty = () => (
  <Popover>
    <TerminalsRosterPanel processes={[]} nowMs={NOW_MS} />
  </Popover>
);
