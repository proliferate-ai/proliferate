import { Button } from "@/components/ui/Button";
import { AgentGlyph } from "@/components/ui/icons";

interface SubagentWakeBadgeProps {
  label?: string | null;
  childSessionId?: string | null;
  outcome?: string | null;
  color?: string;
  titleFallback?: string;
  agentKind?: string | null;
  onOpenChild?: (childSessionId: string) => void;
}

export function SubagentWakeBadge({
  label,
  childSessionId,
  outcome,
  color,
  titleFallback = "Subagent",
  agentKind,
  onOpenChild,
}: SubagentWakeBadgeProps) {
  const title = label?.trim() || titleFallback;
  const status = formatWakeStatus(outcome);
  const canOpenChild = !!childSessionId && !!onOpenChild;
  const content = (
    <>
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full"
        aria-hidden="true"
      >
        <AgentGlyph agentKind={agentKind} color={color} className="size-4" />
      </span>
      <span className="min-w-0 truncate">"{title}"</span>
      <span className="min-w-0 shrink-0">{status}</span>
    </>
  );

  if (canOpenChild) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="md"
        title={`Open ${title}`}
        aria-label={`Open ${title}`}
        onClick={() => onOpenChild(childSessionId)}
        className="h-auto max-w-[77%] justify-start gap-1 break-words rounded-2xl bg-foreground/5 px-3 py-2 text-left text-[length:var(--text-chat)] font-normal leading-[var(--text-chat--line-height)] text-foreground hover:bg-foreground/8 hover:text-foreground"
        data-telemetry-mask
      >
        {content}
      </Button>
    );
  }

  return (
    <div
      className="max-w-[77%] break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground"
      data-telemetry-mask
    >
      <div className="flex min-w-0 items-center gap-1 text-chat leading-[var(--text-chat--line-height)]">
        {content}
      </div>
    </div>
  );
}

function formatWakeStatus(outcome: string | null | undefined): string {
  if (!outcome || outcome === "completed") {
    return "Turn Completed";
  }
  return `Turn ${outcome.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}`;
}
