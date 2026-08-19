import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { PromptAttachmentController } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import { useHomeNextLaunch } from "#product/hooks/home/workflows/use-home-next-launch";
import { useHomeDraftHandoffStore } from "#product/stores/home/home-draft-handoff-store";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
  ModelAvailabilityState,
} from "#product/lib/domain/home/home-next-launch";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";
import type { ChatComposerKeyboardEvent } from "#product/hooks/chat/ui/use-chat-composer-keyboard";

interface UseHomeNextComposerStateArgs {
  targetDisabledReason: string | null;
  modelAvailabilityState: ModelAvailabilityState;
  canLaunchTarget: boolean;
  modelSelection: HomeNextModelSelection | null;
  launchControlValues: Record<string, string>;
  launchTarget: HomeLaunchTarget | null;
  attachments: PromptAttachmentController;
}

export function useHomeNextComposerState({
  targetDisabledReason,
  modelAvailabilityState,
  canLaunchTarget,
  modelSelection,
  launchControlValues,
  launchTarget,
  attachments,
}: UseHomeNextComposerStateArgs) {
  const [draftState, setDraftState] = useState<{
    value: string;
    snapshot?: ChatComposerEditorSnapshot;
  }>({ value: "" });
  const draft = draftState.value;
  const restoredDraftText = useHomeDraftHandoffStore((state) => state.draftText);
  const clearRestoredDraftText = useHomeDraftHandoffStore((state) => state.clearDraftText);
  const { isLaunching, launch } = useHomeNextLaunch();

  useEffect(() => {
    if (restoredDraftText !== null) {
      setDraftState({ value: restoredDraftText });
      clearRestoredDraftText();
    }
  }, [clearRestoredDraftText, restoredDraftText]);

  // Attachment-only submits are legal, matching the chat composer: supported
  // attachments count as prompt content.
  const isEmpty = draft.trim().length === 0 && !attachments.hasSupportedAttachments;
  // Deliberately not gated on `isLaunching`: a launch in flight is exactly the
  // state a second Enter has to be allowed in, since the whole point is that
  // two launches can run at once. `isLaunching` still drives the send button's
  // spinner, it just no longer refuses the next prompt (PRO-230).
  const submitDisabledReason = isEmpty ? null : targetDisabledReason;
  const canSubmit =
    !isEmpty
    && modelAvailabilityState === "launchable"
    && canLaunchTarget
    && !!modelSelection
    && !!launchTarget;

  const setDraft = useCallback((
    value: string,
    snapshot?: ChatComposerEditorSnapshot,
  ) => {
    setDraftState(snapshot ? { value, snapshot } : { value });
  }, []);

  const submit = useCallback(async () => {
    // No submit-in-flight lock: the draft is cleared synchronously below, so a
    // repeated Enter fails `canSubmit` on an empty draft, and a genuinely new
    // prompt is a second launch rather than a dropped one. `launch` owns the
    // same-prompt debounce for the case the two collide (PRO-230).
    if (!canSubmit || !modelSelection || !launchTarget) return;

    const submittedDraft = draftState;
    // Snapshotted now so files attached mid-launch stay out of this send.
    // The chips stay visible until success: failure keeps them alongside the
    // restored draft, mirroring the chat composer's clear-on-success contract.
    const attachmentSnapshots = attachments.snapshotForSubmit();
    const restoreSubmittedDraft = () => {
      setDraftState((currentDraft) => (
        currentDraft.value.length === 0 ? submittedDraft : currentDraft
      ));
    };
    flushSync(() => {
      setDraftState({ value: "" });
    });

    try {
      const outcome = await launch({
        text: submittedDraft.value,
        attachmentSnapshots,
        modelSelection,
        launchControlValues,
        target: launchTarget,
      });
      // A duplicate submit collapsed into a launch that is running, so the
      // draft stays gone: putting it back would offer the user a re-send of a
      // prompt already on its way (PRO-230 review finding 7).
      if (outcome === "launched" || outcome === "duplicate") {
        attachments.clearSubmittedAttachments(attachmentSnapshots);
      } else {
        restoreSubmittedDraft();
      }
    } catch {
      // `launch` normally converts workflow failures to `false`. Keep the
      // composer rollback invariant even if an unexpected error escapes it.
      restoreSubmittedDraft();
    }
  }, [
    attachments,
    canSubmit,
    draftState,
    launch,
    launchControlValues,
    launchTarget,
    modelSelection,
  ]);

  const cancel = useCallback(() => {
    if (!isLaunching) {
      setDraftState({ value: "" });
    }
  }, [isLaunching]);

  const handleKeyDown = useCallback((event: ChatComposerKeyboardEvent) => {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    if (
      event.key === "Escape"
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      cancel();
    }
  }, [cancel]);

  return {
    draft,
    editorSnapshot: draftState.snapshot,
    setDraft,
    submitDisabledReason,
    canSubmit,
    isEmpty,
    isLaunching,
    submit,
    cancel,
    handleKeyDown,
  };
}
