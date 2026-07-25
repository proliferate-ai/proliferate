import { useCallback, useRef } from "react";
import type { CurrentPullRequestResponse } from "@anyharness/sdk";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import type { CommitDialogStep } from "@/lib/domain/workspaces/creation/commit-dialog-state";
import { useCommitDialog } from "@/hooks/workspaces/workflows/use-commit-dialog";
import { CommitDialogActions } from "@/components/workspace/git/CommitDialogActions";
import { CommitDialogPrStep } from "@/components/workspace/git/CommitDialogPrStep";

interface CommitDialogProps {
  open: boolean;
  workspaceId: string | null;
  /** Which step to open on (defaults to "actions"). */
  initialStep?: CommitDialogStep;
  runtimeBlockedReason: string | null;
  repoDefaultBranch: string | null;
  onClose: () => void;
  onViewPr: (pullRequest: NonNullable<CurrentPullRequestResponse["pullRequest"]>) => void;
}

export function CommitDialog({
  open,
  workspaceId,
  initialStep = "actions",
  runtimeBlockedReason,
  repoDefaultBranch,
  onClose,
  onViewPr,
}: CommitDialogProps) {
  const state = useCommitDialog({
    workspaceId,
    runtimeBlockedReason,
    repoDefaultBranch,
    initialStep,
    enabled: open && Boolean(workspaceId),
  });

  const { derived, step, isSubmitting } = state;

  // Handle keyboard navigation (up/down/enter/cmd+enter/escape)
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (step === "pull_request") return; // PR step handles its own keys

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.moveFocus("up");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      state.moveFocus("down");
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void state.executeFocusedAction().then((done) => {
        if (done) onClose();
      });
    } else if (event.key === "Enter" && !event.shiftKey) {
      // Only execute if focus is not in the textarea
      const target = event.target as HTMLElement;
      if (target.tagName !== "TEXTAREA") {
        event.preventDefault();
        void state.executeFocusedAction().then((done) => {
          if (done) onClose();
        });
      }
    }
  }, [onClose, state, step]);

  // Handle Cmd+Enter from inside textarea
  const handleTextareaKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void state.executeFocusedAction().then((done) => {
        if (done) onClose();
      });
    }
  }, [onClose, state]);

  const handleViewPr = useCallback(() => {
    if (derived.existingPr) {
      onViewPr(derived.existingPr);
      onClose();
    }
  }, [derived.existingPr, onClose, onViewPr]);

  const handlePrSubmit = useCallback(async () => {
    const done = await state.executeFocusedAction();
    if (done) onClose();
  }, [onClose, state]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={isSubmitting}
      title="Commit or push"
      sizeClassName="w-[420px] max-w-[92vw]"
      headerClassName="sr-only"
      bodyClassName="p-0"
      footerClassName="hidden"
      showCloseButton={false}
      panelClassName="border-border bg-background shadow-xl"
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={dialogRef} onKeyDown={handleKeyDown} className="flex flex-col">
        {step === "actions" ? (
          <CommitDialogActions
            state={state}
            onTextareaKeyDown={handleTextareaKeyDown}
            onViewPr={handleViewPr}
            onClose={onClose}
          />
        ) : (
          <CommitDialogPrStep
            state={state}
            onSubmit={handlePrSubmit}
            onBack={state.goBackFromPr}
            isSubmitting={isSubmitting}
          />
        )}
      </div>
    </ModalShell>
  );
}
