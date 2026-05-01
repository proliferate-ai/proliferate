import { ReviewSetupDialog } from "@/components/workspace/reviews/ReviewSetupDialog";
import { useReviewSetupDialogState } from "@/hooks/reviews/use-review-setup-dialog-state";

export function ConnectedReviewSetupDialog() {
  const state = useReviewSetupDialogState();

  return (
    <ReviewSetupDialog
      open={state.open}
      title={state.title}
      draft={state.draft}
      sessionDefaults={state.sessionDefaults}
      modelGroups={state.modelGroups}
      personalityTemplates={state.personalityTemplates}
      anchorRect={state.anchorRect}
      modelsLoading={state.modelsLoading}
      validationError={state.validationError}
      isSubmitting={state.isSubmitting}
      onDraftChange={state.setDraft}
      onSubmit={state.submit}
      onClose={state.close}
      onManagePersonalities={state.managePersonalities}
    />
  );
}
