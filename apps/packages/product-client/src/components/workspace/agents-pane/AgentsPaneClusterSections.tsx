import { Button } from "#product/primitives/Button";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import {
  agentsPaneCanClose,
  partitionAgentsPaneSections,
  type AgentsPaneAgent,
} from "#product/lib/domain/delegated-work/agents-pane-model";

/**
 * Level 2 — Working / Idle / Done / Closed. Rows are glyph + task title + one
 * status line; clicking a row selects it and drills into the agent (Agents Pane
 * canvas page). Close sits on the row's hover, where the Closures canvas puts
 * it — closing is a pane operation, never a transcript event.
 *
 * Empty sections do not render: a cluster with nothing closed shows no Closed
 * heading.
 */
export function AgentsPaneClusterSections({
  agents,
  onSelect,
  onRequestClose,
}: {
  agents: readonly AgentsPaneAgent[];
  onSelect: (agent: AgentsPaneAgent) => void;
  onRequestClose?: (agent: AgentsPaneAgent) => void;
}) {
  const sections = partitionAgentsPaneSections(agents);
  if (sections.length === 0) {
    return (
      <p className="m-0 px-2 py-1 text-ui text-muted-foreground">
        This session has no agents.
      </p>
    );
  }
  return (
    <div data-agents-pane-sections>
      {sections.map((section) => (
        <div key={section.key} className="mb-4" data-agents-pane-section={section.key}>
          <h2 className="mb-1.5 mt-0 px-1 text-ui-sm font-normal text-sidebar-muted-foreground">
            {section.title}
          </h2>
          <div className="flex flex-col gap-0.5">
            {section.agents.map((agent) => (
              <AgentsPaneAgentRow
                key={agent.sessionLinkId}
                agent={agent}
                onSelect={onSelect}
                onRequestClose={onRequestClose}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentsPaneAgentRow({
  agent,
  onSelect,
  onRequestClose,
}: {
  agent: AgentsPaneAgent;
  onSelect: (agent: AgentsPaneAgent) => void;
  onRequestClose?: (agent: AgentsPaneAgent) => void;
}) {
  const closed = agent.section === "closed";
  return (
    <div
      className="group flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg pe-1 ps-2 py-1 text-left hover:bg-hover"
      data-agents-pane-agent-row
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-ui"
        onClick={() => onSelect(agent)}
      >
        <DelegatedAgentIdenticon
          identity={agent.identity}
          className={`icon-control shrink-0 ${
            closed ? "text-muted-foreground/50" : agent.identity.textColorClassName
          }`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-ui font-medium ${
              closed ? "text-sidebar-muted-foreground" : "text-sidebar-foreground"
            }`}
          >
            {agent.identity.title}
          </span>
          <span
            className={`block truncate text-ui-sm ${
              closed ? "text-faint" : "text-sidebar-muted-foreground"
            }`}
          >
            {agent.statusLine}
          </span>
        </span>
      </Button>
      {onRequestClose && agentsPaneCanClose(agent) && (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="shrink-0 rounded-md px-2 py-0.5 text-ui-sm text-muted-foreground opacity-0 hover:bg-active hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={`Close ${agent.identity.title}`}
          onClick={() => onRequestClose(agent)}
        >
          Close
        </Button>
      )}
    </div>
  );
}
