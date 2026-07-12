import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { X } from "@proliferate/ui/icons";
import { SubagentIdentityGlyph } from "@/components/playground/subagents-ux/identity-receipts/SubagentIdentityGlyph";

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

type ChildStatus = "running" | "completed" | "closed";

interface TranscriptEntry {
  speaker: "user" | "agent" | "tool";
  text: string;
}

interface ChildAgent {
  id: string;
  title: string;
  status: ChildStatus;
  /** Seconds the child had already been running when the scenario loaded. */
  startedOffsetSec: number;
  stepIndex: number;
  stepCount: number;
  completionSummary?: string;
  closedNote?: string;
  /** Local command metadata, never a lifecycle state. */
  endRequested?: boolean;
  transcript: TranscriptEntry[];
}

interface Scenario {
  id: string;
  label: string;
  parentTitle: string;
  parentTranscript: TranscriptEntry[];
  children: ChildAgent[];
}

const PARENT_TAB_ID = "__parent__";

function buildScenarios(): Scenario[] {
  return [
    {
      id: "mid-flight",
      label: "Mid-flight refactor",
      parentTitle: "Refactor payment retry pipeline",
      parentTranscript: [
        { speaker: "user", text: "Refactor the payment retry pipeline so retries are idempotent and observable." },
        { speaker: "agent", text: "I split this into four tracks and delegated three of them. I'm coordinating and reviewing results here." },
        { speaker: "tool", text: "Delegated: Migrate retry schema · Backfill retry metrics · Update retry integration tests" },
        { speaker: "agent", text: "Schema migration finished — see the Done section. The metrics backfill and test update are still running." },
      ],
      children: [
        {
          id: "nav-close/backfill-retry-metrics",
          title: "Backfill retry metrics",
          status: "running",
          startedOffsetSec: 252,
          stepIndex: 3,
          stepCount: 5,
          transcript: [
            { speaker: "agent", text: "Scanning the last 30 days of retry events to reconstruct metric points." },
            { speaker: "tool", text: "query events --topic payment.retry --since 30d → 48,112 rows" },
            { speaker: "agent", text: "Writing backfill batches. Two of five partitions are committed so far." },
          ],
        },
        {
          id: "nav-close/update-retry-tests",
          title: "Update retry integration tests",
          status: "running",
          startedOffsetSec: 98,
          stepIndex: 1,
          stepCount: 4,
          transcript: [
            { speaker: "agent", text: "Reading the existing retry integration suite to map which cases assume at-most-once delivery." },
            { speaker: "tool", text: "read tests/payments/retry_integration.spec.ts (612 lines)" },
          ],
        },
        {
          id: "nav-close/migrate-retry-schema",
          title: "Migrate retry schema",
          status: "completed",
          startedOffsetSec: 1240,
          stepIndex: 6,
          stepCount: 6,
          completionSummary: "Added idempotency_key column, backfilled 3 tables, migration applied cleanly",
          transcript: [
            { speaker: "agent", text: "Adding an idempotency_key column to retry_attempts and the two audit tables." },
            { speaker: "tool", text: "migrate apply 20260711_retry_idempotency → OK (3 tables)" },
            { speaker: "agent", text: "Done. Migration applied cleanly; backfill verified against a sampled 1% of rows." },
          ],
        },
        {
          id: "nav-close/spike-retry-dlq",
          title: "Spike: dead-letter queue sizing",
          status: "closed",
          startedOffsetSec: 2900,
          stepIndex: 2,
          stepCount: 5,
          closedNote: "Closed after finishing its turn — spike superseded by the metrics backfill",
          transcript: [
            { speaker: "agent", text: "Estimating DLQ volume under the proposed retry caps." },
            { speaker: "tool", text: "Closed by you. The agent finished its in-progress turn, then stopped." },
          ],
        },
      ],
    },
    {
      id: "fresh",
      label: "Fresh delegation",
      parentTitle: "Add CSV export to reports",
      parentTranscript: [
        { speaker: "user", text: "Add CSV export to the reports page." },
        { speaker: "agent", text: "I delegated the serializer work and will wire the UI here once it lands." },
      ],
      children: [
        {
          id: "nav-close/report-csv-serializer",
          title: "Build report CSV serializer",
          status: "running",
          startedOffsetSec: 14,
          stepIndex: 1,
          stepCount: 3,
          transcript: [
            { speaker: "agent", text: "Starting on the serializer. Reading the report row model first." },
          ],
        },
      ],
    },
    {
      id: "wrap-up",
      label: "Wrap-up review",
      parentTitle: "Harden auth session handling",
      parentTranscript: [
        { speaker: "user", text: "Harden session handling: rotation, revocation, and audit coverage." },
        { speaker: "agent", text: "All delegated tracks have finished. Review each result below, then delete the ones you've accepted." },
      ],
      children: [
        {
          id: "nav-close/session-rotation",
          title: "Implement session key rotation",
          status: "completed",
          startedOffsetSec: 3600,
          stepIndex: 5,
          stepCount: 5,
          completionSummary: "Rotation on privilege change + 24h schedule, 9 files changed",
          transcript: [
            { speaker: "agent", text: "Rotation triggers on privilege change and on a 24-hour schedule." },
            { speaker: "tool", text: "9 files changed · tests passing" },
          ],
        },
        {
          id: "nav-close/revocation-endpoint",
          title: "Add bulk revocation endpoint",
          status: "completed",
          startedOffsetSec: 3400,
          stepIndex: 4,
          stepCount: 4,
          completionSummary: "POST /sessions/revoke with per-user and global scopes",
          transcript: [
            { speaker: "agent", text: "Endpoint supports per-user and global revocation with an audit event per batch." },
          ],
        },
        {
          id: "nav-close/audit-log-events",
          title: "Emit session audit events",
          status: "completed",
          startedOffsetSec: 2100,
          stepIndex: 3,
          stepCount: 3,
          completionSummary: "Create/refresh/revoke events wired to the audit sink",
          transcript: [
            { speaker: "agent", text: "All three lifecycle events now flow to the audit sink with actor attribution." },
          ],
        },
        {
          id: "nav-close/legacy-cookie-spike",
          title: "Spike: legacy cookie migration",
          status: "closed",
          startedOffsetSec: 5000,
          stepIndex: 1,
          stepCount: 4,
          closedNote: "Closed after finishing its turn — legacy path is being removed instead",
          transcript: [
            { speaker: "agent", text: "Mapping which clients still send the legacy cookie." },
            { speaker: "tool", text: "Closed by you. The agent finished its in-progress turn, then stopped." },
          ],
        },
      ],
    },
  ];
}

function formatElapsed(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
}

function childStatusLine(child: ChildAgent, elapsedSec: number): string {
  switch (child.status) {
    case "running":
      return child.endRequested
        ? "Working · end requested"
        : `Working · ${formatElapsed(elapsedSec)} · step ${child.stepIndex} of ${child.stepCount}`;
    case "completed":
      return `Done in ${formatElapsed(child.startedOffsetSec)} · ${child.completionSummary ?? ""}`;
    case "closed":
      return child.closedNote ?? "Closed";
  }
}

export function NavigationClosePrototype() {
  const scenarios = useMemo(buildScenarios, []);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "mid-flight");
  const [resetCount, setResetCount] = useState(0);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]!;

  const [children, setChildren] = useState<ChildAgent[]>(() => scenario.children);
  const [openTabIds, setOpenTabIds] = useState<string[]>([PARENT_TAB_ID]);
  const [activeTabId, setActiveTabId] = useState<string>(PARENT_TAB_ID);
  const [closeCandidateId, setCloseCandidateId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const finishTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const tablistRef = useRef<HTMLDivElement | null>(null);

  // Roving focus: arrows/Home/End move DOM focus across [role=tab] buttons.
  const onTablistKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabButtons = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [],
    );
    if (tabButtons.length === 0) return;
    const currentIndex = tabButtons.findIndex((button) => button === document.activeElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabButtons.length - 1
        : event.key === "ArrowLeft"
          ? (currentIndex <= 0 ? tabButtons.length - 1 : currentIndex - 1)
          : (currentIndex === -1 || currentIndex === tabButtons.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    tabButtons[nextIndex]?.focus();
  }, []);

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
    (child: ChildAgent) => child.startedOffsetSec + (nowMs - loadedAt) / 1000,
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
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Parent and child sessions"
        onKeyDown={onTablistKeyDown}
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5"
      >
        {openTabIds.map((tabId) => {
          const isParent = tabId === PARENT_TAB_ID;
          const child = isParent ? undefined : childById(tabId);
          if (!isParent && !child) return null;
          const selected = activeTabId === tabId;
          const title = isParent ? scenario.parentTitle : child!.title;
          return (
            <div
              key={tabId}
              className={`group/tab flex max-w-[220px] shrink-0 items-center rounded-md border ${
                selected
                  ? "border-border bg-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60"
              }`}
            >
              {!isParent ? (
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  aria-label={`Close tab for ${title} (keeps the agent running)`}
                  title="Close tab — the agent keeps running"
                  onClick={() => closeTab(tabId)}
                  className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3" aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                role="tab"
                id={`nav-close-tab-${tabId}`}
                aria-selected={selected}
                aria-controls="nav-close-transcript"
                tabIndex={selected ? 0 : -1}
                title={title}
                onClick={() => setActiveTabId(tabId)}
                className={`flex min-w-0 items-center gap-1.5 py-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border ${isParent ? "pl-2" : "pl-1"}`}
              >
                {child ? (
                  <SubagentIdentityGlyph
                    seed={child.id}
                    size={14}
                    dimmed={child.status === "closed"}
                    label={`Identity mark for ${child.title}`}
                  />
                ) : null}
                <span className="truncate text-ui font-medium">{title}</span>
              </Button>
            </div>
          );
        })}
      </div>

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
                  ? childStatusLine(activeChild, elapsedFor(activeChild))
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
                    <PaneRow
                      key={child.id}
                      child={child}
                      isFocused={activeTabId === child.id}
                      statusLine={childStatusLine(child, elapsedFor(child))}
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
                    <PaneRow
                      key={child.id}
                      child={child}
                      isFocused={activeTabId === child.id}
                      statusLine={childStatusLine(child, elapsedFor(child))}
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

function PaneRow({
  child,
  isFocused,
  statusLine,
  onOpen,
  action,
  dimmed = false,
}: {
  child: ChildAgent;
  isFocused: boolean;
  statusLine: string;
  onOpen: () => void;
  action?: { label: string; onClick: () => void; title?: string };
  dimmed?: boolean;
}) {
  return (
    <div
      className={`group/pane-row flex min-h-11 items-center rounded-lg hover:bg-sidebar-accent ${isFocused ? "bg-sidebar-accent" : ""}`}
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-current={isFocused ? "true" : undefined}
        title={child.title}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center justify-start gap-2 px-2 py-1.5 text-left text-sidebar-foreground"
      >
        <SubagentIdentityGlyph
          seed={child.id}
          size={18}
          dimmed={dimmed}
          label={`Identity mark for ${child.title}`}
        />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-ui font-medium ${dimmed ? "text-sidebar-muted-foreground" : ""}`}>
            {child.title}
          </span>
          <span className="block truncate text-ui-sm font-normal text-sidebar-muted-foreground">
            {statusLine}
          </span>
        </span>
      </Button>
      {action ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${action.label} ${child.title}`}
          title={action.title}
          onClick={action.onClick}
          className="mr-1 h-7 shrink-0 px-2 text-sidebar-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-destructive group-hover/pane-row:opacity-100 focus-visible:opacity-100"
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
