import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
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
  modeId: string | null;
  launchControlValues: Record<string, string>;
  launchTarget: HomeLaunchTarget | null;
}

export function useHomeNextComposerState({
  targetDisabledReason,
  modelAvailabilityState,
  canLaunchTarget,
  modelSelection,
  modeId,
  launchControlValues,
  launchTarget,
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

  const submitDisabledReason = draft.trim().length === 0
    ? null
    : targetDisabledReason;
  // Deliberately not gated on `isLaunching`: a launch in flight is exactly the
  // state a second Enter has to be allowed in, since the whole point is that
  // two launches can run at once. `isLaunching` still drives the send button's
  // spinner, it just no longer refuses the next prompt (PRO-230).
  const canSubmit =
    draft.trim().length > 0
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
    const restoreSubmittedDraft = () => {
      setDraftState((currentDraft) => (
        currentDraft.value.length === 0 ? submittedDraft : currentDraft
      ));
    };
    flushSync(() => {
      setDraftState({ value: "" });
    });

    try {
      const succeeded = await launch({
        text: submittedDraft.value,
        modelSelection,
        modeId,
        launchControlValues,
        target: launchTarget,
      });
      if (!succeeded) {
        restoreSubmittedDraft();
      }
    } catch {
      // `launch` normally converts workflow failures to `false`. Keep the
      // composer rollback invariant even if an unexpected error escapes it.
      restoreSubmittedDraft();
    }
  }, [
    canSubmit,
    draftState,
    launch,
    launchControlValues,
    launchTarget,
    modeId,
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
    isLaunching,
    submit,
    cancel,
    handleKeyDown,
  };
}
