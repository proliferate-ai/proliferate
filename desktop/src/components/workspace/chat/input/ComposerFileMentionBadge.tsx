import { Button } from "@/components/ui/Button";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { X } from "@/components/ui/icons";

interface ComposerFileMentionBadgeProps {
  name: string;
  path: string;
  onRemove: () => void;
}

export function ComposerFileMentionBadge({
  name,
  path,
  onRemove,
}: ComposerFileMentionBadgeProps) {
  return (
    <span
      data-telemetry-mask
      className="inline-flex max-w-[16rem] select-none items-center gap-1 rounded-md border border-border/70 bg-foreground/5 px-1.5 py-0.5 align-baseline text-[0.6875rem] leading-tight text-foreground"
      title={path}
    >
      <FileTreeEntryIcon
        name={name}
        path={path}
        kind="file"
        className="size-3.5 shrink-0"
      />
      <span className="min-w-0 truncate">{name}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        tabIndex={-1}
        aria-label={`Remove ${name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove();
        }}
        className="-mr-1 size-5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </Button>
    </span>
  );
}
