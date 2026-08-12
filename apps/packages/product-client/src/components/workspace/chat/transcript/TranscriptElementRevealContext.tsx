import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
  type RefObject,
} from "react";

type RevealTranscriptElement = (element: HTMLElement) => boolean;

const TranscriptElementRevealContext = createContext<RevealTranscriptElement | null>(null);

export function useTranscriptElementReveal(): RevealTranscriptElement | null {
  return useContext(TranscriptElementRevealContext);
}

export function TranscriptElementRevealBoundary({
  bottomInsetPx,
  children,
  notifyProgrammaticScroll,
  scrollRef,
  setPinned,
}: {
  bottomInsetPx: number;
  children: ReactNode;
  notifyProgrammaticScroll: (write: () => void) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  setPinned: (pinned: boolean) => void;
}) {
  const revealElement = useCallback((element: HTMLElement) => {
    const viewport = scrollRef.current;
    if (!viewport || !viewport.contains(element)) {
      return false;
    }

    const nextScrollTop = resolveTranscriptRevealScrollTop({
      bottomInsetPx,
      elementRect: element.getBoundingClientRect(),
      viewport,
      viewportRect: viewport.getBoundingClientRect(),
    });
    if (nextScrollTop === viewport.scrollTop) {
      return true;
    }

    setPinned(false);
    notifyProgrammaticScroll(() => {
      viewport.scrollTop = nextScrollTop;
    });
    return true;
  }, [bottomInsetPx, notifyProgrammaticScroll, scrollRef, setPinned]);

  return (
    <TranscriptElementRevealContext.Provider value={revealElement}>
      {children}
    </TranscriptElementRevealContext.Provider>
  );
}

function resolveTranscriptRevealScrollTop({
  bottomInsetPx,
  elementRect,
  viewport,
  viewportRect,
}: {
  bottomInsetPx: number;
  elementRect: DOMRect;
  viewport: HTMLDivElement;
  viewportRect: DOMRect;
}): number {
  const safeArea = Math.min(Math.max(0, bottomInsetPx), viewportRect.height);
  const visibleBottom = viewportRect.bottom - safeArea;
  let delta = 0;
  if (elementRect.bottom > visibleBottom) {
    delta = elementRect.bottom - visibleBottom;
  } else if (elementRect.top < viewportRect.top) {
    delta = elementRect.top - viewportRect.top;
  }

  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return Math.min(maxScrollTop, Math.max(0, viewport.scrollTop + delta));
}
