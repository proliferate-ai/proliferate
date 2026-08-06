import {
  createContext,
  useContext,
  useLayoutEffect,
  type ReactNode,
} from "react";
import type { TranscriptScrollPauseListener } from "#product/hooks/chat/ui/use-transcript-scroll-priority";

const TranscriptUserScrollContext = createContext(false);
type RegisterSynchronousPause = (
  listener: TranscriptScrollPauseListener,
) => () => void;
const TranscriptScrollPauseRegistryContext =
  createContext<RegisterSynchronousPause | null>(null);

export const TranscriptUserScrollProvider = TranscriptUserScrollContext.Provider;

export function TranscriptScrollPriorityProvider({
  children,
  isUserScrolling,
  registerSynchronousPause,
}: {
  children: ReactNode;
  isUserScrolling: boolean;
  registerSynchronousPause: RegisterSynchronousPause;
}) {
  return (
    <TranscriptScrollPauseRegistryContext.Provider value={registerSynchronousPause}>
      <TranscriptUserScrollProvider value={isUserScrolling}>
        {children}
      </TranscriptUserScrollProvider>
    </TranscriptScrollPauseRegistryContext.Provider>
  );
}

export function useTranscriptUserScrollActive() {
  return useContext(TranscriptUserScrollContext);
}

export function useTranscriptScrollPauseRegistration(
  listener: TranscriptScrollPauseListener,
) {
  const register = useContext(TranscriptScrollPauseRegistryContext);
  useLayoutEffect(() => register?.(listener), [listener, register]);
}
