import type { ConnectorCardStatus } from "@/hooks/mcp/use-connectors-catalog-state";

const TONE_CLASSES: Record<ConnectorCardStatus["tone"], string> = {
  neutral:
    "border-border/60 bg-muted/40 text-muted-foreground",
  muted:
    "border-border/40 bg-muted/30 text-muted-foreground/80",
  warning:
    "border-border/60 bg-muted/40 text-foreground",
  error:
    "border-destructive/40 bg-destructive/10 text-destructive",
};

const INTERACTIVE_TONE_HOVER: Record<ConnectorCardStatus["tone"], string> = {
  neutral: "",
  muted: "",
  warning: "hover:bg-muted/60",
  error: "hover:bg-destructive/15",
};

export function ConnectorStatusChip({
  onClick,
  status,
}: {
  onClick?: () => void;
  status: ConnectorCardStatus;
}) {
  const base =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors";
  const toneClass = TONE_CLASSES[status.tone];

  if (!status.actionable || !onClick) {
    return (
      <span className={`${base} ${toneClass}`}>
        {status.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`${base} ${toneClass} ${INTERACTIVE_TONE_HOVER[status.tone]}`}
    >
      {status.label}
    </button>
  );
}
