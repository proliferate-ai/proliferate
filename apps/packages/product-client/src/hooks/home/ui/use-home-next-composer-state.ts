import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { useHomeNextLaunch } from "#product/hooks/home/workflows/use-home-next-launch";
import { useHomeDraftHandoffStore } from "#product/stores/home/home-draft-handoff-store";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
  ModelAvailabilityState,
} from "#product/lib/domain/home/home-next-launch";

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
  const submitInFlightRef = useRef(false);
  const [draft, setDraft] = useState("");
  const restoredDraftText = useHomeDraftHandoffStore((state) => state.draftText);
  const clearRestoredDraftText = useHomeDraftHandoffStore((state) => state.clearDraftText);
  const { isLaunching, launch } = useHomeNextLaunch();

  useEffect(() => {
    if (restoredDraftText !== null) {
      setDraft(restoredDraftText);
      clearRestoredDraftText();
    }
  }, [clearRestoredDraftText, restoredDraftText]);

  const submitDisabledReason = draft.trim().length === 0
    ? null
    : targetDisabledReason;
  const canSubmit =
    draft.trim().length > 0
    && modelAvailabilityState === "launchable"
    && canLaunchTarget
    && !!modelSelection
    && !!launchTarget
    && !isLaunching;

  const submit = useCallback(async () => {
    if (
      !canSubmit
      || !modelSelection
      || !launchTarget
      || submitInFlightRef.current
    ) return;

    submitInFlightRef.current = true;
    const submittedDraft = draft;
    const restoreSubmittedDraft = () => {
      setDraft((currentDraft) => (
        currentDraft.length === 0 ? submittedDraft : currentDraft
      ));
    };
    flushSync(() => {
      setDraft("");
    });

    try {
      const succeeded = await launch({
        text: submittedDraft,
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
    } finally {
      submitInFlightRef.current = false;
    }
  }, [
    canSubmit,
    draft,
    launch,
    launchControlValues,
    launchTarget,
    modeId,
    modelSelection,
  ]);

  const cancel = useCallback(() => {
    if (!isLaunching) {
      setDraft("");
    }
  }, [isLaunching]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === "Escape"
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      cancel();
      return;
    }
    if (
      event.key === "Enter"
      && (event.metaKey || event.ctrlKey)
      && !event.shiftKey
      && !event.altKey
      && canSubmit
    ) {
      event.preventDefault();
      void submit();
    }
  }, [canSubmit, cancel, submit]);

  return {
    draft,
    setDraft,
    submitDisabledReason,
    canSubmit,
    isLaunching,
    submit,
    cancel,
    handleKeyDown,
  };
}
