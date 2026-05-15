import { DelegatedAgentReceiptName } from "@/components/workspace/chat/transcript/DelegatedAgentReceiptName";

interface SubagentWakeBadgeProps {
  label?: string | null;
  childSessionId?: string | null;
  sessionLinkId?: string | null;
  outcome?: string | null;
  titleFallback?: string;
  originKind?: "subagent" | "cowork";
  parentTitle?: string | null;
  onOpenChild?: (childSessionId: string) => void;
}

export function SubagentWakeBadge({
  label,
  childSessionId,
  sessionLinkId,
  outcome,
  titleFallback = "Subagent",
  onOpenChild,
}: SubagentWakeBadgeProps) {
  const title = label?.trim() || titleFallback;
  const receiptText = formatWakeReceipt(outcome);

  return (
    <p
      className="max-w-[77%] text-right text-chat leading-[var(--text-chat--line-height)] text-muted-foreground"
      data-telemetry-mask
    >
      <DelegatedAgentReceiptName
        id={sessionLinkId ?? childSessionId ?? title}
        title={title}
        sessionId={childSessionId ?? null}
        sessionLinkId={sessionLinkId ?? null}
        onOpenSession={onOpenChild}
      />
      <span> {receiptText}.</span>
    </p>
  );
}

function formatWakeReceipt(outcome: string | null | undefined): string {
  const normalized = normalizeOutcome(outcome);
  if (!normalized || normalized === "completed") {
    return "finished a turn";
  }
  if (normalized === "failed") {
    return "failed a turn";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled a turn";
  }
  return `${normalized} a turn`;
}

function normalizeOutcome(outcome: string | null | undefined): string | null {
  const normalized = outcome
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}
