import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";

export type TranscriptOpenSessionHandler = (
  sessionId: string,
  role?: TranscriptOpenSessionRole,
) => void;

/**
 * Whether the transcript pane's initial paint for the current session has
 * committed. Rows that mount as part of that first paint treat their existing
 * content as finalized history (ADR Q15 restore-finalized); rows that first
 * appear inside an established pane carry content that arrived while the
 * viewer was watching, so it may animate. The object is mutated in place —
 * consumers read it once at their own mount and must not subscribe to it.
 */
export interface TranscriptPaneLifecycle {
  initialPaintComplete: boolean;
}

// No provider (isolated renders, tests, playground) behaves like a pane-initial
// paint: mount-time content paints finalized, the safe direction under Q15.
const DEFAULT_PANE_LIFECYCLE: TranscriptPaneLifecycle = { initialPaintComplete: false };

const TranscriptSessionIdContext = createContext<string | null>(null);
const TranscriptPaneLifecycleContext =
  createContext<TranscriptPaneLifecycle>(DEFAULT_PANE_LIFECYCLE);
const TranscriptOpenSessionContext = createContext<TranscriptOpenSessionHandler | null>(null);
const TranscriptCanOpenSessionContext = createContext<
  ((sessionId: string, role?: TranscriptOpenSessionRole) => boolean) | null
>(null);

export function TranscriptContextProviders({
  sessionId,
  onOpenSession,
  canOpenSession,
  children,
}: {
  sessionId: string;
  onOpenSession?: TranscriptOpenSessionHandler;
  canOpenSession?: (sessionId: string, role?: TranscriptOpenSessionRole) => boolean;
  children: ReactNode;
}) {
  // Reset in render (not an effect) on session change: the swapped session's
  // rows first-render in the same commit and must already see a fresh
  // pane-initial lifecycle, before any effect can run.
  const paneLifecycleRef = useRef<{
    sessionId: string;
    lifecycle: TranscriptPaneLifecycle;
  }>({ sessionId, lifecycle: { initialPaintComplete: false } });
  if (paneLifecycleRef.current.sessionId !== sessionId) {
    paneLifecycleRef.current = {
      sessionId,
      lifecycle: { initialPaintComplete: false },
    };
  }
  const paneLifecycle = paneLifecycleRef.current.lifecycle;
  // Runs after every commit; the first commit for this session's tree flips
  // the flag, so rows mounted in that commit read false and later ones true.
  useEffect(() => {
    paneLifecycle.initialPaintComplete = true;
  });

  return (
    <TranscriptSessionIdContext.Provider value={sessionId}>
      <TranscriptPaneLifecycleContext.Provider value={paneLifecycle}>
        <TranscriptOpenSessionContext.Provider value={onOpenSession ?? null}>
          <TranscriptCanOpenSessionContext.Provider value={canOpenSession ?? null}>
            {children}
          </TranscriptCanOpenSessionContext.Provider>
        </TranscriptOpenSessionContext.Provider>
      </TranscriptPaneLifecycleContext.Provider>
    </TranscriptSessionIdContext.Provider>
  );
}

export function useTranscriptPaneLifecycle(): TranscriptPaneLifecycle {
  return useContext(TranscriptPaneLifecycleContext);
}

export function useTranscriptSessionId(): string | null {
  return useContext(TranscriptSessionIdContext);
}

export function useTranscriptOpenSession(): TranscriptOpenSessionHandler | null {
  return useContext(TranscriptOpenSessionContext);
}

export function useTranscriptCanOpenSession():
  | ((sessionId: string, role?: TranscriptOpenSessionRole) => boolean)
  | null {
  return useContext(TranscriptCanOpenSessionContext);
}
