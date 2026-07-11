import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Archive, X } from "@proliferate/ui/icons";
import { SubagentIdentityGlyph } from "../identity-receipts/SubagentIdentityGlyph";
import { SubagentCreationReceipt } from "../identity-receipts/SubagentCreationReceipt";
import { AgentGlyph } from "../popover-pane/AgentGlyph";
import { ActivityAggregatePopover } from "../popover-pane/ActivityAggregatePopover";
import { PrototypeComposerSurface } from "../popover-pane/PopoverPanePrototype";
import {
  GlobalAgentsPanePrototype,
  type GlobalAgentsParentFixture,
} from "../popover-pane/GlobalAgentsPanePrototype";
import type { PrototypeAgent } from "../popover-pane/PopoverPaneFixtures";
import {
  buildFullFlowWorkspace,
  FULL_FLOW_STATUS_LABELS,
  type FullFlowArchivedSession,
  type FullFlowChild,
  type FullFlowMessage,
  type FullFlowParent,
} from "./FullFlowFixtures";

/**
 * The coherent default lane: one app-like surface that walks the whole model
 * end to end — immutable creation receipts in the parent transcript, the
 * aggregate activity cap above the inert composer, the global navigation-only
 * Agents pane (overview → parent drill → child open), child sessions as
 * normal full-chat tabs clustered right of their parent, tab close (hide
 * only, control on the left) vs relationship delete (confirm drain for
 * active, immediate for completed), and archive reopen after delete.
 */

type TabDescriptor =
  | { kind: "parent"; parentId: string }
  | { kind: "child"; parentId: string; childId: string }
  | { kind: "archived"; archivedId: string };

function tabKey(tab: TabDescriptor): string {
  switch (tab.kind) {
    case "parent":
      return `parent:${tab.parentId}`;
    case "child":
      return `child:${tab.childId}`;
    case "archived":
      return `archived:${tab.archivedId}`;
  }
}

type PaneView = { mode: "overview" } | { mode: "parent"; parentId: string };

function childToPaneAgent(child: FullFlowChild): PrototypeAgent {
  return {
    id: child.id,
    label: child.label,
    harness: child.harness,
    status: child.status,
    wakeScheduled: child.wakeScheduled,
    detail: child.detail,
  };
}

export function FullFlowPrototype() {
  const [workspace, setWorkspace] = useState(buildFullFlowWorkspace);
  const [openTabs, setOpenTabs] = useState<TabDescriptor[]>(() => (
    buildFullFlowWorkspace().parents.map((parent) => ({
      kind: "parent" as const,
      parentId: parent.id,
    }))
  ));
  const [activeTabKey, setActiveTabKey] = useState<string>(() => (
    `parent:${buildFullFlowWorkspace().parents[0]?.id ?? ""}`
  ));
  const [paneOpen, setPaneOpen] = useState(true);
  const [paneView, setPaneView] = useState<PaneView>({ mode: "overview" });
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => {
    const fresh = buildFullFlowWorkspace();
    setWorkspace(fresh);
    setOpenTabs(fresh.parents.map((parent) => ({ kind: "parent", parentId: parent.id })));
    setActiveTabKey(`parent:${fresh.parents[0]?.id ?? ""}`);
    setPaneOpen(true);
    setPaneView({ mode: "overview" });
    setDeleteCandidateId(null);
  }, []);

  const parentById = useCallback(
    (parentId: string) => workspace.parents.find((parent) => parent.id === parentId),
    [workspace],
  );
  const childById = useCallback(
    (childId: string) => {
      for (const parent of workspace.parents) {
        const child = parent.children.find((candidate) => candidate.id === childId);
        if (child) return { parent, child };
      }
      return undefined;
    },
    [workspace],
  );

  // Create-or-focus: a child owns at most one tab, inserted or moved into the
  // contiguous child-agent run immediately to the right of its parent tab.
  const openChildTab = useCallback((parentId: string, childId: string) => {
    setOpenTabs((tabs) => {
      const existing = tabs.find((tab) => tab.kind === "child" && tab.childId === childId);
      const without = existing ? tabs.filter((tab) => tab !== existing) : tabs;
      const parentIndex = without.findIndex(
        (tab) => tab.kind === "parent" && tab.parentId === parentId,
      );
      if (parentIndex === -1) {
        return [...without, { kind: "child", parentId, childId }];
      }
      let insertAt = parentIndex + 1;
      while (insertAt < without.length) {
        const candidate = without[insertAt];
        if (!candidate || candidate.kind !== "child" || candidate.parentId !== parentId) break;
        insertAt += 1;
      }
      const next = [...without];
      next.splice(insertAt, 0, { kind: "child", parentId, childId });
      return next;
    });
    setActiveTabKey(`child:${childId}`);
  }, []);

  const openArchivedTab = useCallback((archivedId: string) => {
    setOpenTabs((tabs) => (
      tabs.some((tab) => tab.kind === "archived" && tab.archivedId === archivedId)
        ? tabs
        : [...tabs, { kind: "archived", archivedId }]
    ));
    setActiveTabKey(`archived:${archivedId}`);
  }, []);

  // Closing a tab only hides the tab. The relationship — and the session —
  // are untouched; the roster row in the Agents pane keeps working.
  const closeTab = useCallback((key: string) => {
    setOpenTabs((tabs) => {
      const index = tabs.findIndex((tab) => tabKey(tab) === key);
      const next = tabs.filter((tab) => tabKey(tab) !== key);
      setActiveTabKey((active) => (
        active === key
          ? tabKey(next[Math.max(0, index - 1)] ?? next[0] ?? { kind: "parent", parentId: "" })
          : active
      ));
      return next;
    });
  }, []);

  // Relationship delete: the link leaves the parent's active roster and the
  // child session moves to the archive, where its transcript stays
  // reopenable. Any open tab for the child is removed.
  const deleteChild = useCallback((childId: string, activeWorkEnded: boolean) => {
    setWorkspace((prev) => {
      let removed: { parent: FullFlowParent; child: FullFlowChild } | undefined;
      const parents = prev.parents.map((parent) => {
        const child = parent.children.find((candidate) => candidate.id === childId);
        if (!child) return parent;
        removed = { parent, child };
        return {
          ...parent,
          children: parent.children.filter((candidate) => candidate.id !== childId),
        };
      });
      if (!removed) return prev;
      const archivedSession: FullFlowArchivedSession = {
        id: removed.child.id,
        label: removed.child.label,
        parentTitle: removed.parent.title,
        closedDetail: "Closed · Just now",
        transcript: [
          ...removed.child.transcript,
          {
            speaker: "tool",
            text: activeWorkEnded
              ? "Deleted by you. Active work was ended; the session transcript stays available here."
              : "Deleted by you. The session transcript stays available here.",
          },
        ],
      };
      return { parents, archived: [archivedSession, ...prev.archived] };
    });
    closeTab(`child:${childId}`);
  }, [closeTab]);

  // Confirm only when active work would be ended (starting/running);
  // idle/completed/failed relationships delete immediately.
  const requestDelete = useCallback((childId: string) => {
    const found = childById(childId);
    if (!found) return;
    const isActive = found.child.status === "starting"
      || found.child.status === "running";
    if (isActive) {
      setDeleteCandidateId(childId);
    } else {
      deleteChild(childId, false);
    }
  }, [childById, deleteChild]);

  // Roving focus on the tab strip: only the active tab is in the tab order;
  // arrows move DOM focus, Home/End jump, Enter/Space selects.
  const onTablistKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabButtons = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [],
    );
    if (tabButtons.length === 0) return;
    const currentIndex = tabButtons.findIndex((button) => button === document.activeElement);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = currentIndex <= 0 ? tabButtons.length - 1 : currentIndex - 1;
        break;
      case "ArrowRight":
        nextIndex = currentIndex === -1 || currentIndex === tabButtons.length - 1
          ? 0
          : currentIndex + 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      default:
        nextIndex = tabButtons.length - 1;
    }
    event.preventDefault();
    tabButtons[nextIndex]?.focus();
  }, []);

  const paneParents: GlobalAgentsParentFixture[] = useMemo(
    () => workspace.parents
      .filter((parent) => parent.children.length > 0)
      .map((parent) => ({
        id: parent.id,
        title: parent.title,
        agents: parent.children.map(childToPaneAgent),
      })),
    [workspace],
  );

  const activeTab = openTabs.find((tab) => tabKey(tab) === activeTabKey)
    ?? openTabs[0];
  const deleteCandidate = deleteCandidateId ? childById(deleteCandidateId) : undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Full flow</h1>
          <p className="truncate text-xs text-muted-foreground">
            Receipt → cap → global pane → parent drill → child tab → close vs delete → archive reopen
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
        <Button
          type="button"
          variant={paneOpen ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={paneOpen}
          onClick={() => setPaneOpen((open) => !open)}
        >
          Agents pane
        </Button>
      </header>

      {/* Tab strip: parent anchors, child tabs clustered to their right with
          the close control on the LEFT, delegated bubbles on the parent's right. */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Sessions"
        onKeyDown={onTablistKeyDown}
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5"
      >
        {openTabs.map((tab) => {
          const key = tabKey(tab);
          const selected = key === activeTabKey;
          if (tab.kind === "parent") {
            const parent = parentById(tab.parentId);
            if (!parent) return null;
            return (
              <ParentTab
                key={key}
                parent={parent}
                selected={selected}
                onSelect={() => setActiveTabKey(key)}
                onOpenCluster={() => {
                  setPaneOpen(true);
                  setPaneView({ mode: "parent", parentId: parent.id });
                }}
              />
            );
          }
          if (tab.kind === "child") {
            const found = childById(tab.childId);
            if (!found) return null;
            return (
              <ChildTab
                key={key}
                child={found.child}
                selected={selected}
                onSelect={() => setActiveTabKey(key)}
                onCloseTab={() => closeTab(key)}
              />
            );
          }
          const archived = workspace.archived.find(
            (session) => session.id === tab.archivedId,
          );
          if (!archived) return null;
          return (
            <ArchivedTab
              key={key}
              session={archived}
              selected={selected}
              onSelect={() => setActiveTabKey(key)}
              onCloseTab={() => closeTab(key)}
            />
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Main area: the normal Chat view — transcript plus inert composer.
            Never a transcript browser inside the Agents pane. */}
        <main
          role="tabpanel"
          id="full-flow-chat"
          aria-labelledby={activeTab ? `full-flow-tab-${tabKey(activeTab)}` : undefined}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          {activeTab?.kind === "parent" ? (
            <ParentChatView
              parent={parentById(activeTab.parentId)}
              onOpenChild={(childId) => {
                if (activeTab.kind !== "parent") return;
                // Receipts are immutable history: if the relationship was
                // deleted since creation, the receipt reopens the archived
                // session instead of a live child tab.
                if (childById(childId)) {
                  openChildTab(activeTab.parentId, childId);
                } else if (workspace.archived.some((session) => session.id === childId)) {
                  openArchivedTab(childId);
                }
              }}
              onOpenAgentsPane={() => {
                setPaneOpen(true);
                setPaneView(
                  activeTab.kind === "parent"
                    ? { mode: "parent", parentId: activeTab.parentId }
                    : { mode: "overview" },
                );
              }}
            />
          ) : null}
          {activeTab?.kind === "child" ? (
            <ChildChatView found={childById(activeTab.childId)} />
          ) : null}
          {activeTab?.kind === "archived" ? (
            <ArchivedChatView
              session={workspace.archived.find((s) => s.id === activeTab.archivedId)}
            />
          ) : null}
          {!activeTab ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">No open sessions.</p>
            </div>
          ) : null}
        </main>

        {/* Global Agents pane: navigation only. */}
        {paneOpen ? (
          <aside className="w-72 shrink-0 border-l border-sidebar-border">
            <GlobalAgentsPanePrototype
              parents={paneParents}
              archived={workspace.archived.map((session) => ({
                id: session.id,
                label: session.label,
                parentTitle: session.parentTitle,
                closedDetail: session.closedDetail,
              }))}
              selectedParentId={paneView.mode === "parent" ? paneView.parentId : null}
              activeAgentId={activeTab?.kind === "child" ? activeTab.childId : null}
              onSelectParent={(parentId) => setPaneView({ mode: "parent", parentId })}
              onBack={() => setPaneView({ mode: "overview" })}
              onOpenAgent={openChildTab}
              onDeleteAgent={(_parentId, agentId) => requestDelete(agentId)}
              onOpenArchived={openArchivedTab}
            />
          </aside>
        ) : null}
      </div>

      <ConfirmationDialog
        open={deleteCandidate != null}
        title={deleteCandidate ? `Delete "${deleteCandidate.child.label}"?` : ""}
        description="This agent still has active work. Deleting ends that work, then removes the agent from this chat. Its session transcript moves to the archive and stays readable. This can't be undone."
        confirmLabel="End work and delete"
        confirmVariant="destructive"
        onClose={() => setDeleteCandidateId(null)}
        onConfirm={() => {
          if (deleteCandidateId) {
            deleteChild(deleteCandidateId, true);
            setDeleteCandidateId(null);
          }
        }}
      />
    </div>
  );
}

const TAB_SHELL_CLASS = "group/tab flex max-w-[240px] shrink-0 items-center rounded-md border";

function tabToneClass(selected: boolean): string {
  return selected
    ? "border-border bg-accent text-foreground"
    : "border-transparent text-muted-foreground hover:bg-accent/60";
}

function TabCloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-label={`Close tab for ${label} (keeps the session)`}
      title="Close tab — hides the tab only"
      onClick={onClose}
      className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100"
    >
      <X className="size-3" aria-hidden="true" />
    </Button>
  );
}

function ParentTab({
  parent,
  selected,
  onSelect,
  onOpenCluster,
}: {
  parent: FullFlowParent;
  selected: boolean;
  onSelect: () => void;
  onOpenCluster: () => void;
}) {
  const bubbleChildren = parent.children.slice(0, 3);
  const overflow = parent.children.length - bubbleChildren.length;
  return (
    <div className={`${TAB_SHELL_CLASS} ${tabToneClass(selected)}`}>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        role="tab"
        id={`full-flow-tab-parent:${parent.id}`}
        aria-selected={selected}
        aria-controls="full-flow-chat"
        tabIndex={selected ? 0 : -1}
        title={parent.title}
        onClick={onSelect}
        className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
      >
        <span className="truncate text-ui font-medium">{parent.title}</span>
      </Button>
      {parent.children.length > 0 ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label={`${parent.children.length} delegated ${parent.children.length === 1 ? "agent" : "agents"} for ${parent.title} — open Agents pane`}
          title="Delegated agents — open Agents pane"
          onClick={onOpenCluster}
          className="mr-1 flex shrink-0 items-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        >
          <span className="flex items-center -space-x-1.5">
            {bubbleChildren.map((child) => (
              <span
                key={child.id}
                className="flex size-[16px] items-center justify-center rounded-full bg-background ring-1 ring-border"
              >
                <AgentGlyph id={child.id} size={10} />
              </span>
            ))}
          </span>
          {overflow > 0 ? (
            <span className="ml-0.5 font-mono text-xs text-muted-foreground">
              +{overflow}
            </span>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}

function ChildTab({
  child,
  selected,
  onSelect,
  onCloseTab,
}: {
  child: FullFlowChild;
  selected: boolean;
  onSelect: () => void;
  onCloseTab: () => void;
}) {
  return (
    <div className={`${TAB_SHELL_CLASS} ${tabToneClass(selected)}`}>
      <TabCloseButton label={child.label} onClose={onCloseTab} />
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        role="tab"
        id={`full-flow-tab-child:${child.id}`}
        aria-selected={selected}
        aria-controls="full-flow-chat"
        tabIndex={selected ? 0 : -1}
        title={child.label}
        onClick={onSelect}
        className="flex min-w-0 items-center gap-1.5 py-1 pl-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
      >
        <SubagentIdentityGlyph
          seed={child.id}
          size={13}
          label={`Identity mark for ${child.label}`}
        />
        <span className="truncate text-ui font-medium">{child.label}</span>
      </Button>
    </div>
  );
}

function ArchivedTab({
  session,
  selected,
  onSelect,
  onCloseTab,
}: {
  session: FullFlowArchivedSession;
  selected: boolean;
  onSelect: () => void;
  onCloseTab: () => void;
}) {
  return (
    <div className={`${TAB_SHELL_CLASS} ${tabToneClass(selected)}`}>
      <TabCloseButton label={session.label} onClose={onCloseTab} />
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        role="tab"
        id={`full-flow-tab-archived:${session.id}`}
        aria-selected={selected}
        aria-controls="full-flow-chat"
        tabIndex={selected ? 0 : -1}
        title={`${session.label} (archived)`}
        onClick={onSelect}
        className="flex min-w-0 items-center gap-1.5 py-1 pl-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
      >
        <SubagentIdentityGlyph
          seed={session.id}
          size={13}
          dimmed
          label={`Identity mark for ${session.label}`}
        />
        <span className="truncate text-ui font-medium text-muted-foreground">
          {session.label}
        </span>
      </Button>
    </div>
  );
}

function TranscriptMessage({ message }: { message: FullFlowMessage }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-ui-sm text-muted-foreground">
        {message.speaker === "user" ? "You" : message.speaker === "agent" ? "Agent" : "System"}
      </p>
      <p className={`text-ui leading-5 ${message.speaker === "tool" ? "text-muted-foreground" : "text-foreground"}`}>
        {message.text}
      </p>
    </div>
  );
}

function ParentChatView({
  parent,
  onOpenChild,
  onOpenAgentsPane,
}: {
  parent: FullFlowParent | undefined;
  onOpenChild: (childId: string) => void;
  onOpenAgentsPane: () => void;
}) {
  if (!parent) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-10 py-4">
          {parent.transcript.map((item, index) => (
            item.kind === "message" ? (
              <TranscriptMessage key={index} message={item.message} />
            ) : (
              // Quiet immutable historical event: the receipt records the
              // creation as it happened. Live status stays in the pane/tab.
              <div key={index} className="mb-3 last:mb-0">
                <SubagentCreationReceipt
                  model={item.receipt}
                  density="compact"
                  onOpenSession={(subagentId) => onOpenChild(subagentId)}
                />
              </div>
            )
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col px-5 pb-6">
        <div className="px-5">
          <ActivityAggregatePopover
            git={parent.git}
            agents={parent.children.map(childToPaneAgent)}
            onOpenSubagentsPane={onOpenAgentsPane}
          />
        </div>
        <PrototypeComposerSurface />
      </div>
    </div>
  );
}

function ChildChatView({
  found,
}: {
  found: { parent: FullFlowParent; child: FullFlowChild } | undefined;
}) {
  if (!found) return null;
  const { parent, child } = found;
  // `detail` is already composed from the runtime status ("Working · 4m");
  // wakeScheduled is metadata appended after it, never a roster state.
  const statusLine = [
    child.detail || FULL_FLOW_STATUS_LABELS[child.status],
    child.wakeScheduled ? "Wake scheduled" : null,
  ].filter((part): part is string => part !== null).join(" · ");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <SubagentIdentityGlyph
          seed={child.id}
          size={18}
          label={`Identity mark for ${child.label}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium">{child.label}</p>
          <p className="truncate text-ui-sm text-muted-foreground">
            {statusLine} · Delegated by {parent.title}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{child.harness}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-10 py-4">
          {child.transcript.map((message, index) => (
            <TranscriptMessage key={index} message={message} />
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col px-5 pb-6">
        <PrototypeComposerSurface />
      </div>
    </div>
  );
}

function ArchivedChatView({ session }: { session: FullFlowArchivedSession | undefined }) {
  if (!session) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <SubagentIdentityGlyph
          seed={session.id}
          size={18}
          dimmed
          label={`Identity mark for ${session.label}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium">{session.label}</p>
          <p className="truncate text-ui-sm text-muted-foreground">
            {session.closedDetail} · Was delegated by {session.parentTitle}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-10 py-4">
          {session.transcript.map((message, index) => (
            <TranscriptMessage key={index} message={message} />
          ))}
        </div>
      </div>
      {/* Terminal session: no composer, no writable affordance — just a quiet
          read-only footer stating the session is closed. */}
      <footer className="mx-auto w-full max-w-2xl px-5 pb-6">
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-foreground/5 px-3 py-2 text-ui-sm text-muted-foreground">
          <Archive className="size-3.5 shrink-0" aria-hidden="true" />
          <span>This session is closed. The transcript is read-only; no new prompts can be sent.</span>
        </div>
      </footer>
    </div>
  );
}
