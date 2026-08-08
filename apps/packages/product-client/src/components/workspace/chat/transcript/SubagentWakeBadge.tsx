import { AgentChip, AgentChipVerb } from "#product/components/workspace/delegated-work/AgentChip";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

interface SubagentWakeBadgeProps {
  label?: string | null;
  childSessionId?: string | null;
  sessionLinkId?: string | null;
  outcome?: string | null;
  titleFallback?: string;
  onOpenChild?: (childSessionId: string) => void;
}

/**
 * An inbound agent receipt — the same chip language as a spawn or a send, on
 * the other side of the transcript.
 *
 * Direction gets a side (ADR §4): TO an agent is left, FROM an agent is right,
 * where wake receipts always sat. So the verb leads and the chip follows, and
 * the caller aligns the row to the end.
 */
export function SubagentWakeBadge({
  label,
  childSessionId,
  sessionLinkId,
  outcome,
  titleFallback = "Subagent",
  onOpenChild,
}: SubagentWakeBadgeProps) {
  const title = label?.trim() || titleFallback;
  const targetChildSessionId = childSessionId?.trim() || null;
  const canOpenChild = Boolean(targetChildSessionId && onOpenChild);
  const identity = buildDelegatedAgentIdentity({
    id: sessionLinkId ?? childSessionId ?? title,
    title,
    sessionId: childSessionId ?? null,
    sessionLinkId: sessionLinkId ?? null,
  });
  // A wake pointer is addressed by session id when no delegation link carried
  // it — the session-scoped pointer has no link to resolve the target through.
  const addressedById = !sessionLinkId && !!targetChildSessionId;

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-message"
      data-telemetry-mask
      data-agent-inbound-receipt
    >
      <AgentChipVerb>{formatWakeReceipt(outcome)}</AgentChipVerb>
      <AgentChip
        identity={identity}
        showShortId={addressedById}
        onOpen={canOpenChild && targetChildSessionId
          ? () => onOpenChild?.(targetChildSessionId)
          : undefined}
      />
    </div>
  );
}

/**
 * A pointer never carries turn output, so the verb stops at what happened:
 * "finished", or how the turn ended when a completion row says.
 */
function formatWakeReceipt(outcome: string | null | undefined): string {
  const normalized = normalizeOutcome(outcome);
  if (!normalized || normalized === "completed") {
    return "finished";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }
  return normalized;
}

function normalizeOutcome(outcome: string | null | undefined): string | null {
  const normalized = outcome
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}
