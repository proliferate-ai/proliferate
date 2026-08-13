import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { FileText } from "#product/primitives/icons/workspace";
import type { AssistantMarkdownEndResource } from "#product/lib/domain/chat/assistant-markdown-end-resource";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";

export function TurnDocumentReferenceCard({
  resource,
}: {
  resource: AssistantMarkdownEndResource;
}) {
  const fileActions = useFileReferenceActions({ rawPath: resource.rawPath });

  return (
    // Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review, check 1):
    // the card shares the diff panel's `--color-diff-panel-surface` fill so a
    // document reference and a diff read as the same object in the transcript.
    // `Card`'s two-fill surface axis does not carry that token.
    <div
      data-turn-document-reference
      className="flex max-w-full flex-col overflow-hidden rounded-lg border border-border/60 bg-diff-panel-surface text-foreground"
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        onClick={() => void fileActions.openPrimary()}
        className="turn-document-reference-trigger flex w-full min-w-0 items-center justify-start gap-2.5 rounded-none px-3 py-3 text-left focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Open preview for ${resource.displayName}`}
      >
        {/*
          Recorded cause (DESIGN_SYSTEM.md § UI-conformance review, check 4),
          identical to TurnDiffPanelHeader's: no `IconTile` tone carries
          `--color-diff-chat-turn-icon-surface`, so the shared fill arrives as a
          token-utility override rather than a fifth tone.
        */}
        <IconTile
          size="lg"
          className="bg-diff-chat-turn-icon-surface text-secondary-foreground"
        >
          <FileText className="icon-display" />
        </IconTile>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-chat font-medium text-foreground">
            {resource.displayName}
          </span>
          <span className="relative block min-h-4 min-w-0 text-chat leading-4 text-muted-foreground">
            <span className="turn-document-type-label block truncate transition-opacity duration-hover">
              {resource.typeLabel}
            </span>
            <span className="turn-document-open-label pointer-events-none absolute inset-0 flex items-center opacity-0 transition-opacity duration-hover">
              Open preview
            </span>
          </span>
        </span>
      </Button>
    </div>
  );
}
