import { ChevronRight } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { FileChangeStats } from "@/components/content/ui/FileChangeStats";

interface FileChangeInlineRowProps {
  label: string;
  filePath: string;
  additions: number;
  deletions: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  onOpenFile?: () => void;
  className?: string;
}

export function FileChangeInlineRow({
  label,
  filePath,
  additions,
  deletions,
  isExpanded = false,
  onToggle,
  onOpenFile,
  className,
}: FileChangeInlineRowProps) {
  const interactive = !!onToggle;
  const fileContent = (
    <span className="truncate [direction:ltr] [unicode-bidi:plaintext]">
      {filePath}
    </span>
  );

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onToggle}
      onKeyDown={
        interactive
          ? (event) => {
              if (
                event.target === event.currentTarget
                && (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                onToggle?.();
              }
            }
          : undefined
      }
      className={`group/file-change-row flex min-w-0 items-center gap-1.5 rounded-md px-0 py-0.5 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground transition-colors ${
        interactive ? "cursor-pointer hover:text-foreground" : ""
      } ${className ?? ""}`}
    >
      <span className="shrink-0 text-foreground/80">{label}</span>
      {onOpenFile ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={filePath}
          onClick={(event) => {
            event.stopPropagation();
            onOpenFile();
          }}
          className="h-auto min-w-0 max-w-full justify-start rounded-none bg-transparent p-0 text-start text-chat font-normal leading-[var(--text-chat--line-height)] text-link-foreground hover:bg-transparent hover:underline focus-visible:ring-1 focus-visible:ring-border"
        >
          {fileContent}
        </Button>
      ) : (
        <span
          title={filePath}
          className="min-w-0 truncate text-start text-link-foreground"
        >
          {fileContent}
        </span>
      )}
      <FileChangeStats additions={additions} deletions={deletions} />
      {interactive && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          className="ml-0.5 size-4 shrink-0 text-muted-foreground/55 opacity-0 transition-all duration-150 hover:bg-muted group-hover/file-change-row:opacity-100"
          aria-label={isExpanded ? "Collapse file diff" : "Expand file diff"}
          aria-expanded={isExpanded}
        >
          <ChevronRight
            className={`size-3 transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </Button>
      )}
    </div>
  );
}
