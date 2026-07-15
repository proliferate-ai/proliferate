import { Button } from "@proliferate/ui/primitives/Button";
import { AgentGlyph } from "./AgentGlyph";
import type { PrototypeAgent } from "./PopoverPaneFixtures";

/**
 * Parent-scoped Subagents right pane using only roster-observable session
 * states. Rows are task-named, clickable, and visibly selected. When
 * `onDeleteAgent` is provided, rows expose a hover Delete action — the
 * relationship-ending affordance, distinct from closing a tab.
 */
export function SubagentsPanePrototype({
  parentTitle,
  agents,
  selectedAgentId,
  onSelectAgent,
  onDeleteAgent,
  showHeader = true,
}: {
  parentTitle: string;
  agents: readonly PrototypeAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onDeleteAgent?: (agentId: string) => void;
  showHeader?: boolean;
}) {
  const failed = agents.filter((agent) => agent.status === "errored");
  const active = agents.filter((agent) => (
    agent.status === "running" || agent.status === "starting"
  ));
  const idle = agents.filter((agent) => agent.status === "idle");
  const done = agents.filter((agent) => agent.status === "completed");
  const summary = [
    failed.length > 0 ? `${failed.length} failed` : null,
    active.length > 0 ? `${active.length} working` : null,
    idle.length > 0 ? `${idle.length} idle` : null,
    done.length > 0 ? `${done.length} done` : null,
  ].filter((part): part is string => part !== null).join(" · ") || "No subagents";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar-background text-sidebar-foreground">
      {showHeader ? (
        <div className="border-b border-sidebar-border px-4 py-3">
          <p className="truncate text-ui font-medium text-sidebar-foreground">{parentTitle}</p>
          <p className="mt-0.5 truncate text-ui-sm text-sidebar-muted-foreground">{summary}</p>
        </div>
      ) : null}
      {agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-xs text-sm leading-5 text-sidebar-muted-foreground">
            No subagents for this chat.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="list" aria-label="Subagents">
          {failed.length > 0 ? (
            <PaneSection
              title="Failed"
              agents={failed}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              onDeleteAgent={onDeleteAgent}
            />
          ) : null}
          {active.length > 0 ? (
            <PaneSection
              title="Working"
              agents={active}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              onDeleteAgent={onDeleteAgent}
            />
          ) : null}
          {idle.length > 0 ? (
            <PaneSection
              title="Idle"
              agents={idle}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              onDeleteAgent={onDeleteAgent}
            />
          ) : null}
          {done.length > 0 ? (
            <PaneSection
              title="Done"
              agents={done}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              onDeleteAgent={onDeleteAgent}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PaneSection({
  title,
  agents,
  selectedAgentId,
  onSelectAgent,
  onDeleteAgent,
}: {
  title: string;
  agents: readonly PrototypeAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onDeleteAgent?: (agentId: string) => void;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="mb-1.5 px-1 text-ui-sm font-normal text-sidebar-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-0.5">
        {agents.map((agent) => (
          <PaneRow
            key={agent.id}
            agent={agent}
            selected={selectedAgentId === agent.id}
            onSelect={() => onSelectAgent(agent.id)}
            onDelete={onDeleteAgent ? () => onDeleteAgent(agent.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function PaneRow({
  agent,
  selected,
  onSelect,
  onDelete,
}: {
  agent: PrototypeAgent;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const detailToneClass = agent.status === "errored"
    ? "text-destructive"
    : "text-sidebar-muted-foreground";
  return (
    <div
      role="listitem"
      className={`group/pane-row flex min-h-11 min-w-0 items-center rounded-lg hover:bg-sidebar-accent ${selected ? "bg-sidebar-accent" : ""}`}
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-current={selected ? "true" : undefined}
        title={`${agent.label} · ${agent.harness} · ${agent.detail}`}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center justify-start gap-2 rounded-lg px-2 py-1.5 text-left text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-border"
      >
        <AgentGlyph id={agent.id} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium">
            {agent.label}
          </span>
          <span className={`block truncate text-ui-sm font-normal ${detailToneClass}`}>
            {agent.detail}
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-sidebar-muted-foreground">
          {agent.harness}
        </span>
      </Button>
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Delete ${agent.label}`}
          title={agent.status === "running" || agent.status === "starting"
            ? "Delete agent — active work will be ended"
            : "Delete agent"}
          onClick={onDelete}
          className="mr-1 h-7 shrink-0 px-2 text-sidebar-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-destructive group-hover/pane-row:opacity-100 focus-visible:opacity-100"
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
}
