import { Button } from "@proliferate/ui/primitives/Button";
import { FileText } from "@proliferate/ui/icons";
import type { AssistantMarkdownEndResource } from "#product/lib/domain/chat/assistant-markdown-end-resource";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";

export function TurnDocumentReferenceCard({
  resource,
}: {
  resource: AssistantMarkdownEndResource;
}) {
  const fileActions = useFileReferenceActions({ rawPath: resource.rawPath });

  return (
    <div
      data-turn-document-reference
      className="flex max-w-full flex-col overflow-hidden rounded-lg border border-border/60 bg-[var(--color-diff-panel-surface)] text-foreground"
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        onClick={() => void fileActions.openPrimary()}
        className="turn-document-reference-trigger flex w-full min-w-0 items-center justify-start gap-2.5 rounded-none px-3 py-3 text-left focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Open preview for ${resource.displayName}`}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-diff-chat-turn-icon-surface)] text-secondary-foreground">
          <FileText className="size-6" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
            {resource.displayName}
          </span>
          <span className="relative block min-h-4 min-w-0 text-xs leading-4 text-muted-foreground">
            <span className="turn-document-type-label block truncate transition-opacity duration-150">
              {resource.typeLabel}
            </span>
            <span className="turn-document-open-label pointer-events-none absolute inset-0 flex items-center opacity-0 transition-opacity duration-150">
              Open preview
            </span>
          </span>
        </span>
      </Button>
    </div>
  );
}
