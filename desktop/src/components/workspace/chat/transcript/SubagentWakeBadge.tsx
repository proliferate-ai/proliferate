import { Button } from "@/components/ui/Button";
import { Robot } from "@/components/ui/icons";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";

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
  const identity = buildDelegatedAgentIdentity({
    id: sessionLinkId ?? childSessionId ?? title,
    title,
    sessionId: childSessionId ?? null,
    sessionLinkId: sessionLinkId ?? null,
  });
  const receiptText = formatWakeReceipt(identity.displayName, outcome);
  const canOpenChild = !!childSessionId && !!onOpenChild;
  const openChild = () => {
    if (canOpenChild) {
      onOpenChild(childSessionId!);
    }
  };
  const content = (
    <>
      <Robot className={`size-3.5 shrink-0 ${identity.textColorClassName}`} />
      <span className="min-w-0 truncate">{receiptText}</span>
    </>
  );
  const chip = canOpenChild ? (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      data-telemetry-mask
      data-chat-transcript-ignore
      title={`Open ${identity.displayName}`}
      aria-label={`Open ${identity.displayName}`}
      onClick={openChild}
      className="inline-flex max-w-[77%] items-center gap-1.5 rounded-2xl bg-foreground/5 px-3 py-1.5 text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] text-foreground hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </Button>
  ) : (
    <div
      className="inline-flex max-w-[77%] items-center gap-1.5 rounded-2xl bg-foreground/5 px-3 py-1.5 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-foreground"
      data-telemetry-mask
    >
      {content}
    </div>
  );

  return chip;
}

function formatWakeReceipt(title: string, outcome: string | null | undefined): string {
  const normalized = normalizeOutcome(outcome);
  if (!normalized || normalized === "completed") {
    return `${title} finished a turn`;
  }
  if (normalized === "failed") {
    return `${title} failed a turn`;
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return `${title} cancelled a turn`;
  }
  return `${title} ${normalized} a turn`;
}

function normalizeOutcome(outcome: string | null | undefined): string | null {
  const normalized = outcome
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}
