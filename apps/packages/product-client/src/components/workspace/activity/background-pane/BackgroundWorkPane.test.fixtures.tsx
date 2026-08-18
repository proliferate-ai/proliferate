/**
 * Shared, mechanical test fixtures for `BackgroundWorkPane`'s two split
 * test files:
 *  - `BackgroundWorkPane.test.tsx` — roster/scopes/seam/detail-routing.
 *  - `BackgroundWorkPane.finish-signals.test.tsx` — the R5 finish-signal
 *    ladder concerns: the NoticeBanner, pending-selection consumption, and
 *    feed isOpen-gating.
 *
 * Split for PROD-SIZE-1 (the repo-wide 600-line cap, `scripts/check_max_lines.py`):
 * R2-R5 review rounds accumulated coverage onto one file until it hit 690
 * lines. No behavior or assertion changed by the split — every test moved
 * verbatim into one of the two files above, and this module holds only the
 * value builders and component stand-ins both files need identically.
 *
 * The `.test.` mid-name segment is LOAD-BEARING, not stylistic: it must
 * contain the literal substring `.test.` so `report_frontend_structure.py`'s
 * `should_skip` exempts the raw `<button>` mocks in here, while NOT ending in
 * `.test.tsx` so vitest's include glob does not collect it as an (empty)
 * suite. Renaming it either way silently breaks one of those two gates.
 */
import type { ActivityProcessWire } from "#product/domain/activity/process";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";

export function makeProcess(overrides: Partial<ActivityProcessWire>): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "npm test",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-16T00:00:00Z",
    endedAt: null,
    feed: null,
    ...overrides,
  };
}

export function makeAgent(overrides: Partial<ActivitySubagentWire>): ActivitySubagentWire {
  return {
    id: "agent-1",
    agentType: "claude-subagent",
    description: "Native subagent",
    model: null,
    background: true,
    status: { status: "running" },
    usage: null,
    feed: null,
    ...overrides,
  };
}

// `LiveTerminalsRosterPanel`, `AgentsRosterPanel`, `BackgroundTerminalView`
// and `BackgroundSubagentView` own live feed wiring (`useFeedStream`,
// `useSessionDirectoryStore`) that is out of scope for BackgroundWorkPane's
// own unit tests — those components have their own dedicated tests. Stubbed
// here so BackgroundWorkPane's own logic (scope switching, counts, the
// terminal + subagent seams, the finish-signal banner) is what's under test
// in both split files.
export function LiveTerminalsRosterPanelMock({
  processes,
  onOpen,
}: {
  processes: ActivityProcessWire[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div data-testid="live-terminals-roster-panel">
      <span data-testid="live-terminals-roster-panel-ids">
        {processes.map((process) => process.id).join(",")}
      </span>
      {processes.map((process) => (
        <div
          key={process.id}
          role="button"
          tabIndex={0}
          data-testid={`open-process-${process.id}`}
          onClick={() => onOpen?.(process.id)}
        >
          open {process.id}
        </div>
      ))}
    </div>
  );
}

export function BackgroundTerminalViewMock({
  process,
  feed,
  onBack,
}: {
  process: ActivityProcessWire;
  feed: { feedId: string } | null;
  onBack: () => void;
}) {
  return (
    <div
      data-testid="background-terminal-view"
      data-process-id={process.id}
      data-feed-enabled={String(feed !== null)}
    >
      <button type="button" onClick={onBack}>
        Back to background work
      </button>
    </div>
  );
}

export function AgentsRosterPanelMock({
  agents,
  onOpen,
}: {
  agents: ActivitySubagentWire[];
  workspaceId: string;
  onOpen?: (id: string) => void;
}) {
  return (
    <div data-testid="agents-roster-panel">
      {agents.map((agent) => (
        <div
          key={agent.id}
          role="button"
          tabIndex={0}
          data-testid={`open-subagent-${agent.id}`}
          onClick={() => onOpen?.(agent.id)}
        >
          {agent.id}
        </div>
      ))}
    </div>
  );
}

export function BackgroundSubagentViewMock({
  subagent,
  onBack,
}: {
  subagent: ActivitySubagentWire;
  onBack: () => void;
}) {
  return (
    <div
      data-testid="background-subagent-view"
      data-subagent-id={subagent.id}
      data-feed-enabled={String(subagent.feed !== null)}
    >
      <button type="button" onClick={onBack}>
        Back to background work
      </button>
    </div>
  );
}
