import { Button } from "@/components/ui/Button";
import { ProliferateIcon } from "@/components/ui/icons";

interface UserMessageProvenanceChromeProps {
  sourceSessionId: string;
  label?: string | null;
  color?: string;
  onOpenParent?: (sessionId: string) => void;
}

export function UserMessageProvenanceChrome({
  sourceSessionId,
  label,
  color,
  onOpenParent,
}: UserMessageProvenanceChromeProps) {
  const title = label?.trim() || "Parent agent";
  const content = (
    <>
      <span className="shrink-0 text-muted-foreground/70">Sent by</span>
      <span
        className="flex size-3.5 shrink-0 items-center justify-center"
        style={{ color }}
        aria-hidden="true"
      >
        <ProliferateIcon className="size-3.5" />
      </span>
      <span className="min-w-0 truncate">{title}</span>
    </>
  );

  if (onOpenParent) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto max-w-full justify-end gap-1.5 rounded-none bg-transparent px-0 py-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0"
        title={`Open ${title}`}
        aria-label={`Open ${title}`}
        data-telemetry-mask
        onClick={() => onOpenParent(sourceSessionId)}
      >
        {content}
      </Button>
    );
  }

  return (
    <div
      className="flex max-w-full items-center justify-end gap-1.5 text-xs text-muted-foreground"
      data-telemetry-mask
    >
      {content}
    </div>
  );
}
