import type { ToolCallItem } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { FileText } from "@/components/ui/icons";
import { deriveCoworkArtifactToolPresentation } from "@/lib/domain/chat/cowork-artifact-tool-presentation";
import { resolveCoworkArtifactTitle } from "@/lib/domain/cowork/artifacts";

interface CoworkArtifactTurnCardProps {
  item: ToolCallItem;
  onOpenArtifact?: (artifactId: string) => void;
}

export function CoworkArtifactTurnCard({
  item,
  onOpenArtifact,
}: CoworkArtifactTurnCardProps) {
  const presentation = deriveCoworkArtifactToolPresentation(item);
  if (!presentation) {
    return null;
  }

  const completedActionLabel = presentation.action === "create" ? "Artifact created" : "Artifact updated";
  const fallbackTitle = presentation.provisional.title?.trim()
    || presentation.provisional.path?.trim()
    || (presentation.action === "create" ? "New artifact" : "Artifact");
  const displayTitle = presentation.summary
    ? resolveCoworkArtifactTitle(presentation.summary)
    : fallbackTitle;
  const displayPath = presentation.summary?.path ?? presentation.provisional.path ?? null;
  const displayDescription = presentation.summary?.description ?? presentation.provisional.description;
  const typeLabel = presentation.summary ? formatArtifactType(presentation.summary.type) : null;
  const showOpenButton = !!presentation.summary?.id && !!onOpenArtifact;

  return (
    <div className="space-y-1.5 py-0.5">
      <div className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md pl-0.5 pr-1.5 text-sm leading-5 text-muted-foreground">
        <FileText className="size-3 text-faint" />
        <span className="font-[460] text-foreground/90">{completedActionLabel}</span>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/25 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground/90">
              {displayTitle}
            </div>
            {displayPath && (
              <div className="truncate pt-0.5 font-mono text-xs text-muted-foreground">
                {displayPath}
              </div>
            )}
            {(typeLabel || !presentation.summary?.exists) && (
              <div className="pt-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                {[typeLabel, presentation.summary?.exists === false ? "File missing" : null]
                  .filter((value): value is string => Boolean(value))
                  .join(" · ")}
              </div>
            )}
            {displayDescription && (
              <div className="pt-2 text-xs leading-relaxed text-muted-foreground">
                {displayDescription}
              </div>
            )}
            {presentation.failureMessage && (
              <div className="pt-2 text-xs leading-relaxed text-destructive">
                {presentation.failureMessage}
              </div>
            )}
          </div>

          {showOpenButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenArtifact?.(presentation.summary!.id)}
              className="shrink-0"
            >
              Open
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatArtifactType(type: string): string {
  switch (type) {
    case "application/vnd.proliferate.react":
      return "JSX";
    case "image/svg+xml":
      return "SVG";
    case "text/html":
      return "HTML";
    case "text/markdown":
      return "Markdown";
    default:
      return type;
  }
}
