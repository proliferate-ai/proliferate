import { IconButton } from "@/components/ui/IconButton";
import { Copy, Fork, Undo, FileIcon } from "@/components/ui/icons";

interface FileBadge {
  filename: string;
  additions: number;
  deletions: number;
}

interface TurnMetadataProps {
  duration?: string;
  fileBadges?: FileBadge[];
  onCopy?: () => void;
  onFork?: () => void;
  onUndo?: () => void;
}

export function TurnMetadata({
  duration,
  fileBadges,
  onCopy,
  onFork,
  onUndo,
}: TurnMetadataProps) {
  return (
    <div className="flex items-center gap-2 group/meta">
      {duration && (
        <span className="text-xs text-muted-foreground">{duration}</span>
      )}

      {onCopy && (
        <IconButton
          onClick={onCopy}
          title="Copy"
          className="opacity-0 group-hover/meta:opacity-100 transition-opacity"
        >
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
      )}

      {onFork && (
        <IconButton
          onClick={onFork}
          title="Fork"
          className="opacity-0 group-hover/meta:opacity-100 transition-opacity"
        >
          <Fork className="h-3 w-3" />
        </IconButton>
      )}

      {onUndo && (
        <IconButton
          onClick={onUndo}
          title="Undo"
          className="opacity-0 group-hover/meta:opacity-100 transition-opacity"
        >
          <Undo className="size-3" />
        </IconButton>
      )}

      {fileBadges &&
        fileBadges.map((badge) => (
          <button
            key={badge.filename}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <FileIcon className="size-3" />
            <span>{badge.filename}</span>
            <span className="text-git-green">+{badge.additions}</span>
            <span className="text-git-red">-{badge.deletions}</span>
          </button>
        ))}
    </div>
  );
}
