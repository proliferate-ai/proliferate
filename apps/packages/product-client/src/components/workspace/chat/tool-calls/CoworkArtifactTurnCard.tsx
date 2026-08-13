import type { ToolCallItem } from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { FileText } from "#product/primitives/icons/workspace";
import { deriveCoworkArtifactToolPresentation } from "#product/domain/chats/tools/cowork-artifact-tool-presentation";
import { resolveCoworkArtifactTitle } from "#product/lib/domain/cowork/artifacts";

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

  const completedActionLabel = presentation.action === "create" ? "Created artifact" : "Updated artifact";
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
    <div className="space-y-1 py-0.5">
      <div className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md pl-0.5 pr-1.5 text-chat leading-5 text-muted-foreground">
        <FileText className="icon-compact text-faint" />
        <span className="text-inherit">{completedActionLabel}</span>
      </div>

      {/*
        Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review, check 1):
        `bg-muted/25` is a quarter-strength wash chosen to sit under the
        transcript's own tint without stacking into a second visible plane.
        `Card` offers the borderless `bg-surface-elevated-secondary` tint or the
        opaque `bg-card`, neither of which is this. Needs a ruling on `Card`.
      */}
      <div className="rounded-md border border-border/60 bg-muted/25 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-chat font-medium text-foreground/90">
              {displayTitle}
            </div>
            {displayPath && (
              <div className="truncate pt-0.5 text-chat text-muted-foreground">
                {displayPath}
              </div>
            )}
            {(typeLabel || !presentation.summary?.exists) && (
              <div className="pt-1 text-chat uppercase tracking-[0.08em] text-muted-foreground">
                {[typeLabel, presentation.summary?.exists === false ? "File missing" : null]
                  .filter((value): value is string => Boolean(value))
                  .join(" · ")}
              </div>
            )}
            {displayDescription && (
              <div className="pt-2 text-chat leading-relaxed text-muted-foreground">
                {displayDescription}
              </div>
            )}
            {presentation.failureMessage && (
              <div className="pt-2 text-chat leading-relaxed text-destructive">
                {presentation.failureMessage}
              </div>
            )}
          </div>

          {showOpenButton && (
            <Button
              variant="ghost"
              size="sm"
              data-chat-transcript-ignore
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
