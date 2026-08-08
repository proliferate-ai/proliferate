import { useState } from "react";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { Textarea } from "#product/primitives/Textarea";
import { Tooltip } from "#product/primitives/Tooltip";
import { Copy } from "#product/primitives/icons/core";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import { AgentsPaneHeader } from "#product/components/workspace/agents-pane/AgentsPaneHeader";
import {
  AGENTS_PANE_COMPOSER_PLACEHOLDER,
  AGENTS_PANE_CONFIGURE_ACTION,
  AGENTS_PANE_CONFIGURE_HINT,
  AGENTS_PANE_PROMOTED_BADGE,
  AGENTS_PANE_WAKE_TOGGLE_LABEL,
  AGENTS_PANE_WAKE_TOGGLE_UNAVAILABLE_HINT,
  agentsPaneCanClose,
  agentsPaneCanPromote,
  agentsPaneDetailEntries,
  type AgentsPaneAgent,
} from "#product/lib/domain/delegated-work/agents-pane-model";

/**
 * Level 3 — one agent (Agent Operations canvas, DETAIL block).
 *
 * Glyph, title, status line, copyable short id, and the facts the read models
 * carry: Parent prompt / Tool / latest Agent message. Actions are the ADR's
 * four — Open as tab · Configure agent… · Promote · Close; the composer at the
 * bottom is the same messaging primitive the agents use, delivered on the
 * agent's next turn.
 */
export function AgentsPaneAgentDetail({
  agent,
  closeAttribution,
  onBack,
  onOpenSession,
  onConfigure,
  onRequestPromote,
  onRequestClose,
  onSend,
  isSending = false,
}: {
  agent: AgentsPaneAgent;
  closeAttribution?: string | null;
  onBack: () => void;
  onOpenSession: (agent: AgentsPaneAgent) => void;
  onConfigure: (agent: AgentsPaneAgent) => void;
  onRequestPromote: (agent: AgentsPaneAgent) => void;
  onRequestClose: (agent: AgentsPaneAgent) => void;
  onSend: (agent: AgentsPaneAgent, text: string) => void;
  isSending?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const closed = agent.section === "closed";
  const entries = agentsPaneDetailEntries(agent, { closeAttribution });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-agents-pane-detail>
      <AgentsPaneHeader
        title={agent.identity.title}
        summary={agent.statusLine}
        onBack={onBack}
        glyph={(
          <DelegatedAgentIdenticon
            identity={agent.identity}
            className={`icon-large shrink-0 ${
              closed ? "text-muted-foreground/50" : agent.identity.textColorClassName
            }`}
          />
        )}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-light px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="unstyled"
          className="flex h-control items-center gap-1 rounded-md px-2 text-ui-sm"
          onClick={() => onOpenSession(agent)}
        >
          Open as tab
        </Button>
        {/* The agent's own config controls live in its composer, which is
            built for the session in view. So this opens the agent rather than
            growing a second configuration surface in the pane. */}
        <Tooltip content={AGENTS_PANE_CONFIGURE_HINT}>
          <Button
            type="button"
            variant="ghost"
            size="unstyled"
            className="flex h-control items-center gap-1 rounded-md px-2 text-ui-sm"
            onClick={() => onConfigure(agent)}
          >
            {AGENTS_PANE_CONFIGURE_ACTION}
          </Button>
        </Tooltip>
        <Button
          type="button"
          variant="ghost"
          size="unstyled"
          className="flex h-control items-center gap-1 rounded-md px-2 font-mono text-ui-sm"
          aria-label={`Copy session id ${agent.identity.shortId}`}
          onClick={() => {
            void navigator.clipboard?.writeText(agent.childSessionId);
            setCopied(true);
          }}
        >
          <Copy className="icon-compact" />
          {copied ? "Copied" : agent.identity.shortId}
        </Button>
        {agentsPaneCanPromote(agent) && (
          <Button
            type="button"
            variant="ghost"
            size="unstyled"
            className="flex h-control items-center gap-1 rounded-md px-2 text-ui-sm"
            onClick={() => onRequestPromote(agent)}
          >
            Promote
          </Button>
        )}
        {agentsPaneCanClose(agent) && (
          <Button
            type="button"
            variant="ghost"
            size="unstyled"
            className="flex h-control items-center gap-1 rounded-md px-2 text-ui-sm hover:text-destructive"
            onClick={() => onRequestClose(agent)}
          >
            Close
          </Button>
        )}
        {agent.ownership === "promoted" && (
          <Badge tone="neutral">{AGENTS_PANE_PROMOTED_BADGE}</Badge>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-3">
          {entries.map((entry, index) => (
            <div key={`${entry.kind}-${index}`} className="min-w-0">
              <p className="m-0 text-ui-sm text-faint">{entry.label}</p>
              <p
                className={`m-0 mt-0.5 text-chat ${
                  entry.kind === "tool"
                    ? "font-mono text-readable-code text-muted-foreground"
                    : "text-foreground/90"
                }`}
                style={{ textWrap: "pretty" }}
              >
                {entry.text}
              </p>
            </div>
          ))}
        </div>
      </div>
      {!closed && (
        <div className="shrink-0 border-t border-border-light px-3 py-2.5">
          <Textarea
            rows={2}
            value={draft}
            placeholder={AGENTS_PANE_COMPOSER_PLACEHOLDER}
            aria-label={AGENTS_PANE_COMPOSER_PLACEHOLDER}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {/* The wake toggle is the agents' `wakeOnReply`, and the human
                prompt route carries no such flag — so it says so instead of
                pretending to arm one. */}
            <Tooltip content={AGENTS_PANE_WAKE_TOGGLE_UNAVAILABLE_HINT}>
              <Button
                type="button"
                variant="ghost"
                size="unstyled"
                disabled
                aria-disabled="true"
                className="flex h-control items-center gap-1 rounded-md px-2 text-ui-sm"
                data-agents-pane-wake-toggle
              >
                {AGENTS_PANE_WAKE_TOGGLE_LABEL}
              </Button>
            </Tooltip>
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={isSending}
              disabled={draft.trim().length === 0}
              onClick={() => {
                onSend(agent, draft.trim());
                setDraft("");
              }}
            >
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
