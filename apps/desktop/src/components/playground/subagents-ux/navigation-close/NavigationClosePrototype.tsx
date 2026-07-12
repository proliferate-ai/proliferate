import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { SubagentIdentityGlyph } from "@/components/playground/subagents-ux/identity-receipts/SubagentIdentityGlyph";
import {
  buildNavigationCloseScenarios,
  navigationCloseChildStatusLine,
  type NavigationCloseChildAgent,
} from "@/lib/domain/playground/subagents-ux/navigation-close-model";
import { NavigationClosePaneRow } from "./NavigationClosePaneRow";
import { NavigationCloseTabs } from "./NavigationCloseTabs";

/**
 * Interactive prototype for parent↔child navigation plus close/delete
 * semantics. Encodes the reference-derived rules:
 * - visible names are task-derived titles; identity is a persistent glyph
 * - status is text/time/structure, never pills
 * - the right pane is parent-scoped (Working / Done) and never changes when
 *   the focused tab changes; closed relationships are archived elsewhere
 * - opening a child creates or focuses exactly one tab, inserted immediately
 *   to the right of the parent tab
 * - closing a tab only removes the tab; the relationship survives
 * - deleting an *active* relationship confirms and honestly records the end
 *   request while runtime status remains running; deleting completed work is
 *   immediate
 * - no fake undo anywhere
 */

const PARENT_TAB_ID = "__parent__";

export function NavigationClosePrototype() {
  const scenarios = useMemo(buildNavigationCloseScenarios, []);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "mid-flight");
  const [resetCount, setResetCount] = useState(0);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]!;

  const [children, setChildren] = useState<NavigationCloseChildAgent[]>(() => scenario.children);
  const [openTabIds, setOpenTabIds] = useState<string[]>([PARENT_TAB_ID]);
  const [activeTabId, setActiveTabId] = useState<string>(PARENT_TAB_ID);
  const [closeCandidateId, setCloseCandidateId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const finishTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearFinishTimers = useCallback(() => {
    for (const timer of finishTimersRef.current.values()) clearTimeout(timer);
    finishTimersRef.current.clear();
  }, []);

  // Reset all interactive state whenever the scenario changes or Reset is hit.
  useEffect(() => {
    clearFinishTimers();
    setChildren(scenario.children.map((child) => ({ ...child })));
    setOpenTabIds([PARENT_TAB_ID]);
    setActiveTabId(PARENT_TAB_ID);
    setCloseCandidateId(null);
    setLoadedAt(Date.now());
  }, [scenario, resetCount, clearFinishTimers]);

  useEffect(() => clearFinishTimers, [clearFinishTimers]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedFor = useCallback(
    (child: NavigationCloseChildAgent) => child.startedOffsetSec + (nowMs - loadedAt) / 1000,
    [nowMs, loadedAt],
  );

  const childById = useCallback(
    (id: string) => children.find((child) => child.id === id),
    [children],
  );

  // Create-or-focus: a child owns at most one tab, inserted immediately to
  // the right of the parent tab.
  const openChild = useCallback((childId: string) => {
    setOpenTabIds((tabs) => (
      tabs.includes(childId) ? tabs : [PARENT_TAB_ID, childId, ...tabs.slice(1)]
    ));
    setActiveTabId(childId);
  }, []);

  // Closing a tab only removes the tab; the relationship is untouched.
  const closeTab = useCallback((tabId: string) => {
    setOpenTabIds((tabs) => {
      const index = tabs.indexOf(tabId);
      const next = tabs.filter((id) => id !== tabId);
      setActiveTabId((active) => (
        active === tabId ? (next[Math.max(0, index - 1)] ?? PARENT_TAB_ID) : active
      ));
      return next;
    });
  }, []);

  // Confirmed deletion of an active relationship: status remains the
  // runtime-observable `running` while the explicit end request is pending.
  // The fixture then moves the relationship out of the active roster.
  const confirmDeleteActive = useCallback((childId: string) => {
    setCloseCandidateId(null);
    setChildren((prev) => prev.map((child) => (
      child.id === childId ? { ...child, endRequested: true } : child
    )));
    const timer = setTimeout(() => {
      finishTimersRef.current.delete(childId);
      setChildren((prev) => prev.map((child) => (
        child.id === childId
          ? {
              ...child,
              status: "closed" as const,
              endRequested: false,
              closedNote: "Closed after finishing its turn",
              transcript: [
                ...child.transcript,
                { speaker: "tool" as const, text: "Closed by you. The agent finished its in-progress turn, then stopped." },
              ],
            }
          : child
      )));
      closeTab(childId);
    }, 2600);
    finishTimersRef.current.set(childId, timer);
  }, [closeTab]);

  // Deleting a completed relationship is immediate. The relationship leaves
  // the active roster while its transcript remains retained as closed history.
  const deleteCompleted = useCallback((childId: string) => {
    setChildren((prev) => prev.map((child) => (
      child.id === childId
        ? {
            ...child,
            status: "closed" as const,
            closedNote: "Deleted after completion",
            transcript: [
              ...child.transcript,
              { speaker: "tool" as const, text: "Deleted by you. The archived transcript remains available." },
            ],
          }
        : child
    )));
    closeTab(childId);
  }, [closeTab]);

  const activeChildren = children.filter((child) => child.status === "running");
  const doneChildren = children.filter((child) => child.status === "completed");
  const closeCandidate = closeCandidateId ? childById(closeCandidateId) : undefined;
  const activeChild = activeTabId === PARENT_TAB_ID ? undefined : childById(activeTabId);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground">
      {/* Scenario / reset controls */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Label htmlFor="nav-close-scenario" className="mb-0 text-ui-sm text-muted-foreground">
          Scenario
        </Label>
        <div className="w-48">
          <Select
            id="nav-close-scenario"
            value={scenarioId}
            onChange={(event) => setScenarioId(event.target.value)}
            className="h-7 px-2 text-ui"
          >
            {scenarios.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setResetCount((count) => count + 1)}
          className="h-7 px-2"
        >
          Reset
        </Button>
        <p className="ml-auto truncate text-ui-sm text-muted-foreground">
          Tabs close freely; relationships only end via the pane.
        </p>
      </div>

      {/* Tab strip: parent first, child tabs inserted immediately to its
          right. Roving tabindex: only the active tab participates in the tab
          order; arrows/Home/End move focus between tabs. */}
      <NavigationCloseTabs
        parentTabId={PARENT_TAB_ID}
        openTabIds={openTabIds}
        activeTabId={activeTabId}
        parentTitle={scenario.parentTitle}
        childById={childById}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
      />

      <div className="flex min-h-0 flex-1">
        {/* Main mock transcript — driven only by the focused tab */}
        <div
          role="tabpanel"
          id="nav-close-transcript"
          aria-labelledby={`nav-close-tab-${activeTabId}`}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
            {activeChild ? (
              <SubagentIdentityGlyph
                seed={activeChild.id}
                size={18}
                dimmed={activeChild.status === "closed"}
                label={`Identity mark for ${activeChild.title}`}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-ui font-medium">
                {activeChild ? activeChild.title : scenario.parentTitle}
              </p>
              <p className="truncate text-ui-sm text-muted-foreground">
                {activeChild
                  ? navigationCloseChildStatusLine(activeChild, elapsedFor(activeChild))
                  : `Parent session · ${activeChildren.length} working · ${doneChildren.length} done`}
              </p>
            </div>
            {activeChild?.status === "running" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={activeChild.endRequested}
                onClick={() => setCloseCandidateId(activeChild.id)}
                className="h-7 shrink-0 px-2 text-muted-foreground hover:text-destructive"
              >
                {activeChild.endRequested ? "End requested…" : "Delete agent"}
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {(activeChild ? activeChild.transcript : scenario.parentTranscript).map((entry, index) => (
              <div key={index} className="mb-3 last:mb-0">
                <p className="text-ui-sm text-muted-foreground">
                  {entry.speaker === "user" ? "You" : entry.speaker === "agent" ? "Agent" : "System"}
                </p>
                <p className={`text-ui leading-5 ${entry.speaker === "tool" ? "text-muted-foreground" : "text-foreground"}`}>
                  {entry.text}
                </p>
              </div>
            ))}
            {activeChild?.status === "running" && activeChild.endRequested ? (
              <div className="mb-3">
                <p className="text-ui-sm text-muted-foreground">System</p>
                <p className="text-ui leading-5 text-muted-foreground">
                  End requested. Runtime still reports this session as working; no new work will start.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Parent-scoped right pane: sibling scope never changes with tab focus */}
        <div className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar-background text-sidebar-foreground">
          <div className="border-b border-sidebar-border px-4 py-3">
            <p className="truncate text-ui font-medium">{scenario.parentTitle}</p>
            <p className="mt-0.5 truncate text-ui-sm text-sidebar-muted-foreground">
              {activeChildren.length === 0 && doneChildren.length === 0
                ? "No delegated work"
                : `${activeChildren.length} working · ${doneChildren.length} done`}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {activeChildren.length > 0 ? (
              <section className="mb-4">
                <h2 className="mb-1.5 px-1 text-ui-sm font-normal text-sidebar-muted-foreground">
                  Working
                </h2>
                <div className="flex flex-col gap-0.5">
                  {activeChildren.map((child) => (
                    <NavigationClosePaneRow
                      key={child.id}
                      child={child}
                      isFocused={activeTabId === child.id}
                      statusLine={navigationCloseChildStatusLine(child, elapsedFor(child))}
                      onOpen={() => openChild(child.id)}
                      action={
                        !child.endRequested
                          ? { label: "Delete", onClick: () => setCloseCandidateId(child.id) }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {doneChildren.length > 0 ? (
              <section className="mb-4">
                <h2 className="mb-1.5 px-1 text-ui-sm font-normal text-sidebar-muted-foreground">
                  Done
                </h2>
                <div className="flex flex-col gap-0.5">
                  {doneChildren.map((child) => (
                    <NavigationClosePaneRow
                      key={child.id}
                      child={child}
                      isFocused={activeTabId === child.id}
                      statusLine={navigationCloseChildStatusLine(child, elapsedFor(child))}
                      onOpen={() => openChild(child.id)}
                      action={{
                        label: "Delete",
                        title: "Delete immediately — this can't be undone",
                        onClick: () => deleteCompleted(child.id),
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {activeChildren.length === 0 && doneChildren.length === 0 ? (
              <p className="px-1 pt-2 text-ui-sm text-sidebar-muted-foreground">
                Delegated work for this chat will appear here.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmationDialog
        open={closeCandidate != null}
        title={closeCandidate ? `Delete "${closeCandidate.title}"?` : ""}
        description="This agent has active work. Deleting requests that work to end and removes the relationship from this chat. Its session transcript remains available in the archive."
        confirmLabel="End work and delete"
        confirmVariant="destructive"
        onClose={() => setCloseCandidateId(null)}
        onConfirm={() => {
          if (closeCandidateId) confirmDeleteActive(closeCandidateId);
        }}
      />
    </div>
  );
}
