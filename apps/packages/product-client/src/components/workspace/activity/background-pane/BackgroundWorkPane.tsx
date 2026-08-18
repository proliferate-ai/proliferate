import { useEffect, useState } from "react";
import { SegmentedControl, type SegmentedControlItem } from "#product/primitives/SegmentedControl";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { Button } from "#product/primitives/Button";
import { CircleCheck } from "#product/primitives/icons/status";
import { AgentsRosterPanel } from "#product/components/workspace/activity/AgentsRosterPanel";
import { LiveTerminalsRosterPanel } from "#product/components/workspace/activity/LiveTerminalsRosterPanel";
import { BackgroundTerminalView } from "#product/components/workspace/activity/background-pane/BackgroundTerminalView";
import { BackgroundSubagentView } from "#product/components/workspace/activity/background-pane/BackgroundSubagentView";
import { useSessionActivity } from "#product/hooks/activity/derived/use-session-activity";
import { useBackgroundWorkRowCounts } from "#product/hooks/activity/derived/use-background-work-row";
import { useBackgroundWorkFinishSignal } from "#product/hooks/activity/derived/use-background-work-finish-signal";
import { deriveBackgroundWorkDirty } from "#product/domain/activity/background-work-finish-signal";
import { isProcessRunning, processStatusLabel } from "#product/domain/activity/process";
import { subagentDisplayTitle, subagentStatusLabel } from "#product/domain/activity/subagent";
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
  // The finish-signal ladder rung 2 (`NoticeBanner`) baseline — see the note
  // where this is consumed below for why it must be a snapshot rather than a
  // live store read. Reset alongside everything else in the per-session
  // effect just below rather than relying solely on a lazy `useState`
  // initializer: the real call site remounts this component on session
  // switch (`RightPanelContent` — `key={activeSessionId}`), but this
  // component's own reset should not silently depend on every caller doing
  // that.
  const [lastViewedAtMsBeforeThisMount, setLastViewedAtMsBeforeThisMount] = useState<number | null>(
    () => useWorkspaceUiStore.getState().backgroundWorkLastViewedAtBySession[sessionId] ?? null,
  );
  // Session-scoped by design (handoff — "Out of scope: workspace-level
  // persistence"): switching the active session resets the scope and closes
  // any open detail seam rather than carrying another session's selection.
  useEffect(() => {
    setScope("running");
    setSelectedSubagentId(null);
    setSelectedProcessId(null);
    setLastViewedAtMsBeforeThisMount(
      useWorkspaceUiStore.getState().backgroundWorkLastViewedAtBySession[sessionId] ?? null,
    );
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
  // writer (the transcript click), a single reader (here).
  //
  // Session-scoped on read (review round 2): the entry is keyed by
  // workspace only, but carries the `sessionId` that was active at write
  // time. A click can land here for a session other than this pane's own
  // (e.g. the active session flips between the write and this effect
  // running, or the click originated from an embedded transcript for a
  // different session in the same workspace) — mismatched entries are
  // discarded rather than applied, whether this is a fresh mount or an
  // already-mounted re-render, so a stale cross-session id never leaks into
  // this session's roster lookup.
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
    if (pendingSubagentSelection.sessionId === sessionId) {
      setSelectedSubagentId(pendingSubagentSelection.subagentId);
    }
    clearPendingBackgroundSubagentSelectionForWorkspace(workspaceId);
  }, [
    clearPendingBackgroundSubagentSelectionForWorkspace,
    pendingSubagentSelection,
    sessionId,
    workspaceId,
  ]);

  // Finish-signal ladder rung 2 (`NoticeBanner`, Design Handoff —
  // "When one finishes: Pane notice"): visible only while this pane is both
  // mounted AND actually open (not CSS-collapsed via `WorkspaceShellRightRail`),
  // and only above the roster — the process/subagent detail views below are
  // a full swap of this component's return, so opening either one already
  // removes the banner with no extra state ("clears when the user opens
  // the named detail").
  //
  // The "frozen at mount" baseline is deliberate: the mark-viewed effect
  // right below keeps nudging the LIVE `lastViewedAtMs` forward for as
  // long as the pane stays mounted (so the tab dot never re-lights for a
  // finish this pane already showed live) — comparing the banner's own
  // visibility against that same live value would make it flip false on
  // the very next render after appearing. Comparing against a value
  // snapshotted once per session (see `lastViewedAtMsBeforeThisMount`
  // above), avoids that self-erasing race.
  //
  // Minimal dismissal semantics (handoff is silent on the exact rule):
  // the banner is hidden for as long as either detail view is open (a full
  // swap of this return), and reappears if the user presses Back to the
  // roster within the SAME session (same baseline) — nothing tracks "the
  // user already saw this one" beyond that. It fully, permanently clears
  // only on tab-away (unmount) or a session switch (fresh baseline).
  const finishSignalState = useBackgroundWorkFinishSignal(sessionId);
  const markBackgroundWorkViewedForSession = useWorkspaceUiStore(
    (state) => state.markBackgroundWorkViewedForSession,
  );
  // "Clears on select" (handoff, verbatim) — mounting this pane IS
  // selecting the Background work tab, independent of whether the whole
  // right rail happens to be CSS-collapsed at that instant, so this runs
  // unconditionally rather than gating on `isOpen`.
  useEffect(() => {
    markBackgroundWorkViewedForSession(sessionId, finishSignalState.signal?.atMs);
  }, [sessionId, finishSignalState.signal?.atMs, markBackgroundWorkViewedForSession]);

  const showBackgroundWorkNotice = isOpen && deriveBackgroundWorkDirty({
    latestFinishAtMs: finishSignalState.signal?.atMs ?? null,
    lastViewedAtMs: lastViewedAtMsBeforeThisMount,
  });
  const noticeSignal = showBackgroundWorkNotice ? finishSignalState.signal : null;

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
      {noticeSignal ? (
        <div className="shrink-0 px-3 pt-2" data-background-work-notice="">
          {noticeSignal.kind === "process" ? (
            <NoticeBanner
              tone="neutral"
              icon={<CircleCheck className="text-success" />}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedProcessId(noticeSignal.process.id)}
                >
                  View
                </Button>
              }
            >
              {noticeSignal.process.command} — {processStatusLabel(noticeSignal.process)}
            </NoticeBanner>
          ) : (
            // No View action here — see the "subagent-View-action"
            // contradiction in the R5 PR body. `BackgroundWorkPane.test.tsx`
            // pins the roster-bounce-back behavior for any selected subagent
            // id the live roster can't resolve, and a finished native
            // subagent has, by definition, already left that live roster
            // (locked design, `chips.ts`) — there is no live detail seam
            // left to open. The banner still names what finished.
            <NoticeBanner
              tone="neutral"
              icon={<CircleCheck className="text-success" />}
            >
              {subagentDisplayTitle(noticeSignal.subagent)} — {subagentStatusLabel(noticeSignal.subagent)}
            </NoticeBanner>
          )}
        </div>
      ) : null}
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
