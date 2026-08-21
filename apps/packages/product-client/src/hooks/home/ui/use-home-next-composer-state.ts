import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { PromptAttachmentController } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import { useHomeNextLaunch } from "#product/hooks/home/workflows/use-home-next-launch";
import { useHomeDraftHandoffStore } from "#product/stores/home/home-draft-handoff-store";
import {
  HOME_MODEL_GATE_SEND_BLOCKED_REASON,
  HOME_MODEL_TRIGGER_SELECTOR,
  resolveHomeModelGateRefusalAnnouncement,
  type HomeModelGate,
} from "#product/lib/domain/home/home-model-gate";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";
import type { ChatComposerKeyboardEvent } from "#product/hooks/chat/ui/use-chat-composer-keyboard";

interface UseHomeNextComposerStateArgs {
  targetDisabledReason: string | null;
  modelGate: HomeModelGate;
  canLaunchTarget: boolean;
  modelSelection: HomeNextModelSelection | null;
  launchControlValues: Record<string, string>;
  launchTarget: HomeLaunchTarget | null;
  attachments: PromptAttachmentController;
}

export function useHomeNextComposerState({
  targetDisabledReason,
  modelGate,
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
  // Counts refusals only so the live region's text can differ between two of
  // them; the count itself never reaches the region (ruling 6).
  const [refusalCount, setRefusalCount] = useState(0);

  // A refusal sentence is only true while the gate is still asking for a
  // selection. Left alone it would sit in the accessibility tree for the rest
  // of the session, including after a model was chosen and Send worked.
  useEffect(() => {
    if (modelGate.kind !== "selection_required") {
      setRefusalCount(0);
    }
  }, [modelGate.kind]);

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
    && modelGate.kind === "launchable"
    && canLaunchTarget
    && !!modelSelection
    && !!launchTarget;
  /**
   * The disabled Send's tooltip AND accessible name while a model is unchosen.
   *
   * Empty-guarded exactly as `submitDisabledReason` above is: this string
   * becomes the button's accessible NAME, so on an empty composer — where the
   * button is disabled because there is nothing to send — it would name the
   * wrong reason. The component renders whatever reason it is handed; deciding
   * that the reason applies is this hook's job.
   *
   * selection_required carries no visible notice (owner revision r2), so this
   * reason and the enabled picker pill are the whole of the state's visual
   * story — a Send that still reads "Send (Cmd+Enter)" would be the only thing
   * on screen saying nothing is wrong.
   */
  const sendBlockedReason = !isEmpty && modelGate.kind === "selection_required"
    ? HOME_MODEL_GATE_SEND_BLOCKED_REASON
    : null;
  const refusalAnnouncement = resolveHomeModelGateRefusalAnnouncement(refusalCount);

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

  /**
   * Enter with a draft and no model (ruling 3).
   *
   * The draft is untouched — not cleared, not restored, simply left alone —
   * focus moves to the picker trigger, and the reason is re-committed to the
   * status region. The picker is NOT opened: auto-opening a menu under a
   * keystroke the user did not aim at it steals the caret, and the focused
   * trigger is already one keypress from the same menu.
   *
   * Scoped to `selection_required`, and to that gate ONLY, for two reasons
   * that both have to hold:
   *
   *  - "Choose a model before sending" is only true when there is a model to
   *    choose. Under `agent_setup_required` there is not, and the screen is
   *    already showing the sentence that IS true.
   *  - It is the only gate whose trigger is enabled. Every other blocked
   *    reason renders the trigger as a native `<button disabled>`, which is
   *    not focusable, so `focus()` would be a silent no-op aimed at a control
   *    the user cannot use.
   *
   * An empty composer is not a refusal at all: Enter on an empty Home composer
   * did nothing before this slice and must keep doing nothing, rather than
   * throwing the caret out of the editor the page just autofocused.
   */
  const refuseSubmit = useCallback(() => {
    if (isEmpty || canSubmit || modelGate.kind !== "selection_required") {
      return;
    }
    setRefusalCount((count) => count + 1);
    const trigger = typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>(HOME_MODEL_TRIGGER_SELECTOR);
    trigger?.focus();
  }, [canSubmit, isEmpty, modelGate.kind]);

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
    sendBlockedReason,
    refusalAnnouncement,
    refuseSubmit,
    canSubmit,
    isEmpty,
    isLaunching,
    submit,
    cancel,
    handleKeyDown,
  };
}
