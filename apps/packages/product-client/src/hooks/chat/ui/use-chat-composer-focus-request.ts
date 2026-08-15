import { useEffect } from "react";

interface UseChatComposerFocusRequestArgs {
  focusRequestNonce: number;
  focusComposer: () => boolean;
}

export function useChatComposerFocusRequest({
  focusRequestNonce,
  focusComposer,
}: UseChatComposerFocusRequestArgs): void {
  useEffect(() => {
    if (focusRequestNonce === 0) {
      return;
    }

    let timer: number | null = null;
    let attempts = 0;
    let cancelled = false;
    const attemptFocus = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      if (focusComposer() || attempts >= 8) {
        return;
      }
      timer = window.setTimeout(attemptFocus, 25);
    };

    timer = window.setTimeout(attemptFocus, 0);
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [focusComposer, focusRequestNonce]);
}
