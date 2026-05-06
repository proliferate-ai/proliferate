import { useReviewAssignmentCritiqueQuery } from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

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
      ) : (
        <div className="max-h-[68vh] overflow-y-auto rounded-md border border-border bg-card p-4">
          <pre
            className="whitespace-pre-wrap break-words font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground"
            data-telemetry-mask
          >
            {critiqueQuery.data?.critiqueMarkdown || "No critique body was submitted."}
          </pre>
        </div>
      )}
    </ModalShell>
  );
}
