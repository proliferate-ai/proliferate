import { useEffect, useState } from "react";
import { SegmentedControl, type SegmentedControlItem } from "#product/primitives/SegmentedControl";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { AgentsRosterPanel } from "#product/components/workspace/activity/AgentsRosterPanel";
import { LiveTerminalsRosterPanel } from "#product/components/workspace/activity/LiveTerminalsRosterPanel";
import { BackgroundTerminalView } from "#product/components/workspace/activity/background-pane/BackgroundTerminalView";
import { BackgroundSubagentView } from "#product/components/workspace/activity/background-pane/BackgroundSubagentView";
import { useSessionActivity } from "#product/hooks/activity/derived/use-session-activity";
import { useBackgroundWorkRowCounts } from "#product/hooks/activity/derived/use-background-work-row";
import { isProcessRunning } from "#product/domain/activity/process";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

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
 * `BackgroundTerminalView` (rung R3) and `BackgroundSubagentView` (rung R4)
 * are both wired in below: selecting a roster row stores its id in
 * pane-local state and swaps the roster body for the matching real
 * read-only detail view.
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

  const selectedSubagent = selectedSubagentId
    ? activity.agents.find((agent) => agent.id === selectedSubagentId) ?? null
    : null;
  // Unlike processes, subagents DO leave the roster the instant they finish
  // (the invariant the Closed scope depends on — see `CLOSED_SUBAGENTS_EMPTY_COPY`
  // above), so losing the resolved subagent here is an expected path, not
  // just a defensive guard. Bouncing back to the roster is correct: there is
  // nothing left to mirror live, and the subagent's own final result already
  // lives in the transcript.
  useEffect(() => {
    if (selectedSubagentId && !selectedSubagent) {
      setSelectedSubagentId(null);
    }
  }, [selectedSubagentId, selectedSubagent]);

  // Deep-open target: a native subagent's transcript block click
  // (`TranscriptAgentGroupBlock`'s `onOpenSubagent`, threaded through
  // `useOpenBackgroundWorkPane`'s extended return) writes a one-shot pending
  // selection into the right-panel model rather than reaching into this pane
  // directly (Delivery Spec — Background Work Slice 1, rung R4 fix-forward).
  // Consume it the instant it appears and clear it immediately — a single
  // writer (the transcript click), a single reader (here), so there is no
  // race to arbitrate, unlike `pendingChatActivationByWorkspace`'s
  // epoch/nonce machinery.
  const pendingSubagentSelection = useWorkspaceUiStore(
    (state) => state.pendingBackgroundSubagentSelectionByWorkspace[workspaceId] ?? null,
  );
  const clearPendingBackgroundSubagentSelectionForWorkspace = useWorkspaceUiStore(
    (state) => state.clearPendingBackgroundSubagentSelectionForWorkspace,
  );
  useEffect(() => {
    if (!pendingSubagentSelection) {
      return;
    }
    setSelectedSubagentId(pendingSubagentSelection);
    clearPendingBackgroundSubagentSelectionForWorkspace(workspaceId);
  }, [
    clearPendingBackgroundSubagentSelectionForWorkspace,
    pendingSubagentSelection,
    workspaceId,
  ]);

  if (selectedProcess) {
    return (
      <BackgroundTerminalView
        process={selectedProcess}
        // The right panel collapses via CSS (opacity/inert), not unmount
        // (`WorkspaceShellRightRail`) — a collapsed-but-still-mounted detail
        // view must stop streaming rather than keep the socket open
        // invisibly. `useFeedStream` resets to empty content the instant
        // `enabled` goes false (no partial-content retention to preserve),
        // so gating at this seam — rather than adding a second prop to
        // `BackgroundTerminalView`'s frozen (process, feed, onBack) contract
        // — is both simplest and matches the acceptance line "feed re-tails
        // on detail open": reopening hands the real feed back and the view
        // re-tails from scratch.
        feed={isOpen ? selectedProcess.feed : null}
        onBack={() => setSelectedProcessId(null)}
      />
    );
  }

  if (selectedSubagent) {
    return (
      <BackgroundSubagentView
        subagent={
          // Same feed-gating seam as `BackgroundTerminalView` above: the
          // right panel stays mounted-but-hidden via CSS while closed, so
          // streaming must stop at this boundary rather than at mount.
          // `BackgroundSubagentView`'s frozen (subagent, sessionId,
          // workspaceId, onBack) contract has no separate feed prop, so the
          // gate clones the roster entry with its `feed` nulled instead.
          isOpen ? selectedSubagent : { ...selectedSubagent, feed: null }
        }
        sessionId={sessionId}
        workspaceId={workspaceId}
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
                workspaceId={workspaceId}
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
