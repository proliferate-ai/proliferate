import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { HOME_CHAT_COMPOSER_INPUT } from "@/config/chat";
import { useHomeNextLaunch } from "@/hooks/home/workflows/use-home-next-launch";
import { useHomeDraftHandoffStore } from "@/stores/home/home-draft-handoff-store";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
  ModelAvailabilityState,
} from "@/lib/domain/home/home-next-launch";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    scheduleAfterNextPaint(resolve);
  });
}

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [submittedPreview, setSubmittedPreview] = useState<{
    id: string;
    text: string;
  } | null>(null);
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
    && submittedPreview === null
    && !isLaunching;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const lineHeightPx = parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return;

    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const homeMinHeightPx = Number.isFinite(rootFontSizePx)
      ? rootFontSizePx * HOME_CHAT_COMPOSER_INPUT.minHeightRem
      : lineHeightPx * HOME_CHAT_COMPOSER_INPUT.minRows;
    const minPx = Math.max(lineHeightPx * HOME_CHAT_COMPOSER_INPUT.minRows, homeMinHeightPx);
    const maxPx = lineHeightPx * HOME_CHAT_COMPOSER_INPUT.maxRows;
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    const next = Math.min(maxPx, Math.max(minPx, contentHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = contentHeight > maxPx ? "auto" : "hidden";
  }, [draft]);

  const submit = useCallback(async () => {
    if (!canSubmit || !modelSelection || !launchTarget) return;

    const submittedDraft = draft;
    const submittedText = submittedDraft.trim();
    const shouldShowHomeSubmittedPreview = launchTarget.kind !== "cowork";
    flushSync(() => {
      if (shouldShowHomeSubmittedPreview) {
        setSubmittedPreview({
          id: crypto.randomUUID(),
          text: submittedText,
        });
      }
      setDraft("");
    });
    if (shouldShowHomeSubmittedPreview) {
      await waitForNextPaint();
    }
    const succeeded = await launch({
      text: submittedDraft,
      modelSelection,
      modeId,
      launchControlValues,
      target: launchTarget,
    });
    if (!succeeded) {
      setSubmittedPreview(null);
      setDraft(submittedDraft);
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
      setSubmittedPreview(null);
      setDraft("");
    }
  }, [isLaunching]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
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
    textareaRef,
    draft,
    setDraft,
    submittedPreview,
    submitDisabledReason,
    canSubmit,
    isLaunching,
    submit,
    cancel,
    handleKeyDown,
  };
}
