import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import {
  GlobalAgentsPanePrototype,
  type GlobalAgentsParentFixture,
} from "../popover-pane/GlobalAgentsPanePrototype";
import {
  ArchivedChatView,
  ChildChatView,
  ParentChatView,
  childToPaneAgent,
} from "./FullFlowChatViews";
import {
  buildFullFlowWorkspace,
  type FullFlowArchivedSession,
  type FullFlowChild,
  type FullFlowParent,
} from "./FullFlowFixtures";
import {
  ArchivedTab,
  ChildTab,
  ParentTab,
  tabKey,
  type TabDescriptor,
} from "./FullFlowTabs";

/**
 * The coherent default lane: one app-like surface that walks the whole model
 * end to end — immutable creation receipts in the parent transcript, the
 * aggregate activity cap above the inert composer, the global navigation-only
 * Agents pane (overview → parent drill → child open), child sessions as
 * normal full-chat tabs clustered right of their parent, tab close (hide
 * only, control on the left) vs relationship delete (confirm drain for
 * active, immediate for completed), and archive reopen after delete.
 */

type PaneView = { mode: "overview" } | { mode: "parent"; parentId: string };

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
