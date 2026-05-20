import { useReviewAssignmentCritiqueQuery } from "@anyharness/sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { ModalShell } from "@/components/ui/ModalShell";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const REVIEW_CRITIQUE_MARKDOWN_CLASSNAME = [
  "select-text break-words",
  "[&>*:first-child]:mt-0",
  "[&>*:last-child]:mb-0",
  "[&_h1]:text-sm",
  "[&_h2]:text-sm",
  "[&_h3]:text-sm",
  "[&_p]:text-sm",
  "[&_li]:text-sm",
].join(" ");

export function ConnectedReviewCritiqueDialog() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const target = useReviewUiStore((state) => state.critiqueTarget);
  const close = useReviewUiStore((state) => state.closeCritique);
  const critiqueQuery = useReviewAssignmentCritiqueQuery(
    target?.reviewRunId,
    target?.assignmentId,
    {
      workspaceId: selectedWorkspaceId,
      enabled: !!target,
    },
  );

  return (
    <ModalShell
      open={!!target}
      onClose={close}
      title={target?.personaLabel ?? "Review critique"}
      description="Reviewer critique body."
      sizeClassName="max-w-2xl"
      bodyClassName="px-5 pb-5 pt-2"
      footer={(
        <Button type="button" variant="secondary" onClick={close}>
          Close
        </Button>
      )}
    >
      {critiqueQuery.isLoading ? (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          Loading critique...
        </div>
      ) : critiqueQuery.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to load critique.
        </div>
      ) : critiqueQuery.data?.critiqueMarkdown?.trim() ? (
        <div
          className="max-h-[68vh] overflow-y-auto rounded-md border border-border bg-card px-4 py-3"
          data-telemetry-mask
        >
          <MarkdownRenderer
            content={critiqueQuery.data.critiqueMarkdown.trim()}
            className={REVIEW_CRITIQUE_MARKDOWN_CLASSNAME}
          />
        </div>
      ) : (
        <div
          className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground"
          data-telemetry-mask
        >
          No critique body was submitted.
        </div>
      )}
    </ModalShell>
  );
}
