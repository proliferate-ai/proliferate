import { AgentChip, AgentChipVerb } from "#product/components/workspace/delegated-work/AgentChip";
import { DelegatedAgentHoverCard } from "#product/components/workspace/shell/tabs/DelegatedAgentHoverCard";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type { AgentInboundMessageVerb } from "#product/domain/chats/subagents/agent-message-direction";

/**
 * A message that ARRIVED from another agent — chip + one quiet verb, on the
 * right (ADR §4 "Agent messages").
 *
 * It is deliberately not a `UserMessage`: the ADR says message content never
 * gets its own UI, so the literal body lives in the hover card and nowhere
 * else, the agent's own prose carries the meaning, and the chip opens the
 * thread. Direction gets a side — FROM an agent is right, where inbound
 * receipts have always sat — so the verb leads and the chip follows.
 *
 * Parent or peer is read off `sessionLinkId`, never assumed. A delegation link
 * is the only thing that makes the sender this session's parent; without one
 * the sender is a peer, and calling it a parent would claim an ownership that
 * does not exist.
 */
export function AgentInboundMessageRow({
  sourceSessionId,
  sessionLinkId,
  label,
  verb,
  message,
  onOpenSource,
}: {
  sourceSessionId: string;
  sessionLinkId: string | null;
  label: string | null;
  verb: AgentInboundMessageVerb;
  /** The literal body. Hover card only — never a bubble. */
  message: string | null;
  onOpenSource?: (sessionId: string) => void;
}) {
  const fromParent = !!sessionLinkId?.trim();
  const originLabel = fromParent ? "Parent agent" : "Agent";
  const title = label?.trim() || originLabel;
  const identity = buildDelegatedAgentIdentity({
    id: sessionLinkId ?? sourceSessionId,
    title,
    sessionId: sourceSessionId,
    sessionLinkId: sessionLinkId ?? null,
  });
  const open = onOpenSource ? () => onOpenSource(sourceSessionId) : undefined;
  const hoverAgent = {
    identity,
    kind: "subagent" as const,
    originLabel,
    statusCategory: "finished" as const,
    statusLabel: verb === "replied" ? "Replied" : "Messaged",
    parentTitle: null,
    hoverTitle: [identity.displayName, originLabel].join("\n"),
  };

  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-message"
      data-telemetry-mask
      data-agent-inbound-message
      data-agent-inbound-origin={fromParent ? "parent" : "peer"}
    >
      <AgentChipVerb>{verb}</AgentChipVerb>
      <DelegatedAgentHoverCard
        agent={hoverAgent}
        message={message}
        cardAriaLabel={`Open ${identity.displayName}`}
        onCardClick={open}
      >
        <AgentChip
          identity={identity}
          // Addressed by raw session id: no delegation link resolved the
          // sender, so the mono short id rides inside the chip.
          showShortId={!fromParent}
          onOpen={open}
        />
      </DelegatedAgentHoverCard>
    </div>
  );
}
