import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowLeft, ChevronDown, ChevronRight } from "@proliferate/ui/icons";
import { AgentGlyph, AgentGlyphStack } from "./AgentGlyph";
import {
  buildSubagentAggregate,
  subagentCountsLine,
} from "./PopoverPaneActivityFacts";
import type { PrototypeAgent } from "./PopoverPaneFixtures";
import { SubagentsPanePrototype } from "./SubagentsPanePrototype";

export interface GlobalAgentsParentFixture {
  id: string;
  title: string;
  agents: readonly PrototypeAgent[];
}

export interface GlobalAgentsArchivedFixture {
  id: string;
  label: string;
  parentTitle: string;
  closedDetail: string;
}

/**
 * Navigation-only Agents pane. Overview lists every parent session with
 * visible subagents plus a collapsed archive of closed child sessions;
 * selecting a parent drills into its direct-child roster with Back. Child
 * selection is delegated to the host so the normal Chat view/tab owns the
 * transcript and composer — the pane never renders transcript content.
 */
export function GlobalAgentsPanePrototype({
  parents,
  archived = [],
  selectedParentId,
  activeAgentId,
  onSelectParent,
  onBack,
  onOpenAgent,
  onDeleteAgent,
  onOpenArchived,
}: {
  parents: readonly GlobalAgentsParentFixture[];
  archived?: readonly GlobalAgentsArchivedFixture[];
  selectedParentId: string | null;
  activeAgentId: string | null;
  onSelectParent: (parentId: string) => void;
  onBack: () => void;
  onOpenAgent: (parentId: string, agentId: string) => void;
  onDeleteAgent?: (parentId: string, agentId: string) => void;
  onOpenArchived?: (archivedId: string) => void;
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const selectedParent = parents.find((parent) => parent.id === selectedParentId) ?? null;

  if (selectedParent) {
    const aggregate = buildSubagentAggregate(selectedParent.agents);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar-background text-sidebar-foreground">
        <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to all parent sessions"
            title="Back to Agents overview"
            onClick={onBack}
            className="shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-ui font-medium text-sidebar-foreground">
              {selectedParent.title}
            </p>
            <p className="truncate text-ui-sm text-sidebar-muted-foreground">
              {subagentCountsLine(aggregate) ?? `${aggregate.total} subagents`}
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <SubagentsPanePrototype
            parentTitle={selectedParent.title}
            agents={selectedParent.agents}
            selectedAgentId={activeAgentId}
            onSelectAgent={(agentId) => onOpenAgent(selectedParent.id, agentId)}
            onDeleteAgent={onDeleteAgent
              ? (agentId) => onDeleteAgent(selectedParent.id, agentId)
              : undefined}
            showHeader={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar-background text-sidebar-foreground">
      <div className="shrink-0 border-b border-sidebar-border px-4 py-3">
        <p className="text-ui font-medium text-sidebar-foreground">Agents</p>
        <p className="mt-0.5 text-ui-sm text-sidebar-muted-foreground">
          {parents.length} {parents.length === 1 ? "parent session" : "parent sessions"}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div role="list" aria-label="Parent sessions with subagents">
          {parents.map((parent) => {
            const aggregate = buildSubagentAggregate(parent.agents);
            return (
              <div key={parent.id} role="listitem">
                <Button
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={() => onSelectParent(parent.id)}
                  className="flex min-h-12 w-full min-w-0 items-center justify-start gap-2 rounded-lg px-2 py-1.5 text-left text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-border"
                >
                  <AgentGlyphStack ids={parent.agents.map((agent) => agent.id)} max={3} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui font-medium">{parent.title}</span>
                    <span className="block truncate text-ui-sm text-sidebar-muted-foreground">
                      {subagentCountsLine(aggregate) ?? `${aggregate.total} subagents`}
                    </span>
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-sidebar-muted-foreground" aria-hidden="true" />
                </Button>
              </div>
            );
          })}
        </div>
        {parents.length === 0 ? (
          <p className="px-2 pt-2 text-ui-sm text-sidebar-muted-foreground">
            No parent sessions have active subagents.
          </p>
        ) : null}
        {archived.length > 0 && onOpenArchived ? (
          <section className="mt-4 border-t border-sidebar-border pt-3">
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-expanded={archiveOpen}
              onClick={() => setArchiveOpen((open) => !open)}
              className="mb-1 flex w-full items-center gap-1 px-2 text-left text-ui-sm text-sidebar-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:text-sidebar-foreground"
            >
              {archiveOpen
                ? <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                : <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
              Archive ({archived.length})
            </Button>
            {archiveOpen ? (
              <div role="list" aria-label="Archived agent sessions" className="flex flex-col gap-0.5">
                {archived.map((session) => (
                  <div key={session.id} role="listitem">
                    <Button
                      type="button"
                      variant="unstyled"
                      size="unstyled"
                      title={`${session.label} · ${session.parentTitle}`}
                      onClick={() => onOpenArchived(session.id)}
                      className="flex min-h-11 w-full min-w-0 items-center justify-start gap-2 rounded-lg px-2 py-1.5 text-left text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-border"
                    >
                      <AgentGlyph id={session.id} dimmed />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui font-medium text-sidebar-muted-foreground">
                          {session.label}
                        </span>
                        <span className="block truncate text-ui-sm text-sidebar-muted-foreground">
                          {session.closedDetail} · {session.parentTitle}
                        </span>
                      </span>
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
