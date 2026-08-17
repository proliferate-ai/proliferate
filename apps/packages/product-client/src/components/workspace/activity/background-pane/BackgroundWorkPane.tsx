import { useEffect, useState } from "react";
import { ArrowLeft } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { SegmentedControl, type SegmentedControlItem } from "#product/primitives/SegmentedControl";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { AgentsRosterPanel } from "#product/components/workspace/activity/AgentsRosterPanel";
import { LiveTerminalsRosterPanel } from "#product/components/workspace/activity/LiveTerminalsRosterPanel";
import { BackgroundTerminalView } from "#product/components/workspace/activity/background-pane/BackgroundTerminalView";
import { useSessionActivity } from "#product/hooks/activity/derived/use-session-activity";
import { useBackgroundWorkRowCounts } from "#product/hooks/activity/derived/use-background-work-row";
import { isProcessRunning } from "#product/domain/activity/process";

// Same 15s cadence as the shared `useActivityNowMs`, but reimplemented locally
// rather than reusing it: that hook is documented to tick unconditionally
// because its callers have no visibility signal of their own ("panels where a
// per-second re-render would be pure cost"). This pane uniquely receives
// `isOpen` — the whole right panel's mounted-but-hidden signal, the same one
// `AgentsPane`'s roster polling gates on — so it pauses its own clock instead
// of spending it while the panel is off-screen.
const ELAPSED_TICK_MS = 15_000;

export interface BackgroundWorkPaneProps {
  workspaceId: string;
  sessionId: string;
  /** Whether the right panel hosting this pane is actually open/visible. */
  isOpen: boolean;
}

type BackgroundWorkScope = "running" | "closed";

const CLOSED_SUBAGENTS_EMPTY_COPY =
  "Native subagents leave the roster when they finish; their work stays in the transcript.";

/**
 * The right-panel "Background work" pane: Terminals + Native subagents
 * rosters together, with Running / Closed scopes (Design Handoff —
 * HANDOFF-background-work.md, NEW `BackgroundWorkPane`; Delivery Spec —
 * Background Work Slice 1, rung R2).
 *
 * Loops are descoped by founder ruling for this slice — `LoopsPanel` is not
 * re-hosted here and stays untouched at its current call site.
 *
 * `BackgroundTerminalView` (rung R3) is wired in below: selecting a terminal
 * row stores its process id in pane-local state and swaps the roster body
 * for the real read-only detail view. `BackgroundSubagentView` (rung R4) is
 * still the placeholder seam below — `AgentsRosterPanel`'s `onOpen` stub
 * becomes real here: selecting a subagent row stores its id in pane-local
 * state and swaps the roster body for a minimal placeholder with a back
 * button, clearly marked as the R4 seam `BackgroundSubagentView` fills in.
 */
export function BackgroundWorkPane({ workspaceId, sessionId, isOpen }: BackgroundWorkPaneProps) {
  const [scope, setScope] = useState<BackgroundWorkScope>("running");
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  // Session-scoped by design (handoff — "Out of scope: workspace-level
  // persistence"): switching the active session resets the scope and closes
  // any open detail seam rather than carrying another session's selection.
  useEffect(() => {
    setScope("running");
    setSelectedSubagentId(null);
    setSelectedProcessId(null);
  }, [sessionId]);

  // The roster subscription (`useSessionActivity`) that used to live on
  // `SessionActivityBar` moves here (handoff — MODIFIED `SessionActivityBar`).
  const activity = useSessionActivity();
  const counts = useBackgroundWorkRowCounts();

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), ELAPSED_TICK_MS);
    return () => window.clearInterval(id);
  }, [isOpen]);

  const runningProcesses = activity.processes.filter(isProcessRunning);
  const closedProcesses = activity.processes.filter((process) => !isProcessRunning(process));
  const closedCount = counts.finishedCount;

  const scopeItems: SegmentedControlItem<BackgroundWorkScope>[] = [
    { id: "running", label: `Running (${counts.runningCount})` },
    { id: "closed", label: `Closed (${closedCount})` },
  ];

  const selectedProcess = selectedProcessId
    ? activity.processes.find((process) => process.id === selectedProcessId) ?? null
    : null;
  // Processes never leave the roster on their own (unlike subagents, the
  // Closed scope depends on this), so a selected id should always resolve.
  // Clearing the stale selection is defensive, not an expected path — done
  // in an effect rather than during render.
  useEffect(() => {
    if (selectedProcessId && !selectedProcess) {
      setSelectedProcessId(null);
    }
  }, [selectedProcessId, selectedProcess]);

  if (selectedProcess) {
    return (
      <BackgroundTerminalView
        process={selectedProcess}
        feed={selectedProcess.feed}
        onBack={() => setSelectedProcessId(null)}
      />
    );
  }

  if (selectedSubagentId) {
    return (
      <BackgroundWorkSubagentSeam
        workspaceId={workspaceId}
        subagentId={selectedSubagentId}
        onBack={() => setSelectedSubagentId(null)}
      />
    );
  }

  return (
    <section
      aria-label="Background work"
      data-background-work-pane=""
      data-workspace-id={workspaceId}
      data-session-id={sessionId}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
          Background work
        </h2>
        <SegmentedControl
          items={scopeItems}
          value={scope}
          ariaLabel="Background work scope"
          variant="plain"
          onChange={setScope}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        <div className="flex flex-col gap-3">
          {scope === "running" ? (
            <>
              <LiveTerminalsRosterPanel
                processes={runningProcesses}
                nowMs={nowMs}
                onOpen={setSelectedProcessId}
              />
              <AgentsRosterPanel
                agents={activity.agents}
                nowMs={nowMs}
                onOpen={setSelectedSubagentId}
              />
            </>
          ) : (
            <>
              <LiveTerminalsRosterPanel
                processes={closedProcesses}
                nowMs={nowMs}
                onOpen={setSelectedProcessId}
              />
              {/* Subagents never appear in Closed: they leave the roster the
                  instant they finish (session-activity-architecture rule
                  the Closed scope depends on). `RosterPanel`'s own `empty`
                  slot carries the handoff's exact copy rather than routing
                  through `AgentsRosterPanel`, which only ever renders the
                  RUNNING-only "No active native subagents." line. */}
              <RosterPanel
                title="Native subagents"
                empty={CLOSED_SUBAGENTS_EMPTY_COPY}
                data-agents-roster-panel
              />
            </>
          )}
        </div>
      </div>
      <footer className="border-t border-border px-3 py-2 text-ui-sm text-muted-foreground">
        Read-only. Output is mirrored from the agent; nothing here can steer it.
      </footer>
    </section>
  );
}

/**
 * R4 seam: a minimal, clearly-labeled placeholder standing in for
 * `BackgroundSubagentView` (rung R4). Keeps the selected subagent id in
 * pane-local state (owned by the parent) and offers only a back action —
 * no transcript, no composer, nothing to interact with yet.
 */
function BackgroundWorkSubagentSeam({
  workspaceId,
  subagentId,
  onBack,
}: {
  workspaceId: string;
  subagentId: string;
  onBack: () => void;
}) {
  return (
    <section
      aria-label="Background work — subagent detail"
      data-background-work-subagent-seam=""
      data-workspace-id={workspaceId}
      data-subagent-id={subagentId}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to background work"
          onClick={onBack}
        >
          <ArrowLeft className="icon-compact" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
          Subagent detail
        </h2>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-ui-sm text-muted-foreground">
        The read-only subagent transcript (`BackgroundSubagentView`) lands in
        rung R4 — this is that seam, holding the selected subagent's id.
      </div>
      <footer className="border-t border-border px-3 py-2 text-ui-sm text-muted-foreground">
        Read-only. Transcript mirrored from the agent; no composer.
      </footer>
    </section>
  );
}
