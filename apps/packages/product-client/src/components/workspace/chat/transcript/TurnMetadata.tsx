import { IconButton } from "#product/primitives/IconButton";
import { Button } from "#product/primitives/Button";
import { Copy, Fork, Undo } from "#product/primitives/icons/core";
import { FileIcon } from "#product/primitives/icons/workspace";

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
    <div className="flex items-center gap-1.5 group/meta">
      {duration && (
        <span className="text-ui-sm text-muted-foreground">{duration}</span>
      )}

      {onCopy && (
        <IconButton
          onClick={onCopy}
          title="Copy"
          className="opacity-0 group-hover/meta:opacity-100 transition-opacity"
        >
          <Copy className="icon-paired" />
        </IconButton>
      )}

      {onFork && (
        <IconButton
          onClick={onFork}
          title="Fork"
          className="opacity-0 group-hover/meta:opacity-100 transition-opacity"
        >
          <Fork className="icon-compact" />
        </IconButton>
      )}

      {onUndo && (
        <IconButton
          onClick={onUndo}
          title="Undo"
          className="opacity-0 group-hover/meta:opacity-100 transition-opacity"
        >
          <Undo className="icon-compact" />
        </IconButton>
      )}

      {fileBadges &&
        fileBadges.map((badge) => (
          <Button
            key={badge.filename}
            type="button"
            // The pill's ink, hover and pressed states are `Button`'s ghost
            // variant verbatim, so they are composed rather than restated
            // (DESIGN_SYSTEM.md § UI-conformance review, check 7). Only the
            // pill's own frame and layout stay here.
            variant="ghost"
            size="unstyled"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-chat font-medium transition-colors"
          >
            <FileIcon className="icon-compact [font-size:var(--text-chat)]" />
            <span>{badge.filename}</span>
            <span className="text-git-green">+{badge.additions}</span>
            <span className="text-git-red">-{badge.deletions}</span>
          </Button>
        ))}
    </div>
  );
}
