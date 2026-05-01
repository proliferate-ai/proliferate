import { Button } from "@/components/ui/Button";

interface SubagentWakeBadgeProps {
  label?: string | null;
  childSessionId?: string | null;
  outcome?: string | null;
  titleFallback?: string;
  onOpenChild?: (childSessionId: string) => void;
}

export function SubagentWakeBadge({
  label,
  childSessionId,
  outcome,
  titleFallback = "Subagent",
  onOpenChild,
}: SubagentWakeBadgeProps) {
  const title = label?.trim() || titleFallback;
  const receiptTitle = formatWakeTitle(title, outcome);
  const detail = formatWakeDetail(outcome);
  const canOpenChild = !!childSessionId && !!onOpenChild;

  return (
    <div
      className="grid max-w-[77%] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground"
      data-telemetry-mask
    >
      <div className="min-w-0 text-chat leading-[var(--text-chat--line-height)]">
        <div className="truncate font-medium">{receiptTitle}</div>
        <div className="truncate text-muted-foreground">{detail}</div>
      </div>
      {canOpenChild && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-transcript-ignore
          title={`Open ${title}`}
          aria-label={`Open ${title}`}
          onClick={() => onOpenChild(childSessionId)}
          className="h-7 shrink-0 px-2"
        >
          Open
        </Button>
      )}
    </div>
  );
}

function formatWakeTitle(title: string, outcome: string | null | undefined): string {
  const normalized = normalizeOutcome(outcome);
  if (!normalized || normalized === "completed") {
    return `${title} finished`;
  }
  if (normalized === "failed") {
    return `${title} failed`;
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return `${title} cancelled`;
  }
  return `${title} ${normalized}`;
}

function formatWakeDetail(outcome: string | null | undefined): string {
  const normalized = normalizeOutcome(outcome);
  if (!normalized || normalized === "completed") {
    return "Completed turn";
  }
  if (normalized === "failed") {
    return "Failed turn";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "Cancelled turn";
  }
  return `${normalized.replace(/\b\w/g, (char) => char.toUpperCase())} turn`;
}

function normalizeOutcome(outcome: string | null | undefined): string | null {
  const normalized = outcome
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}
