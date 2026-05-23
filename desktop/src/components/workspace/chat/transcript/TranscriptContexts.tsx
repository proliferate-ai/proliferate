import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { TranscriptOpenSessionRole } from "@proliferate/product-model/chats/transcript/transcript-open-target";

export type TranscriptOpenSessionHandler = (
  sessionId: string,
  role?: TranscriptOpenSessionRole,
) => void;

const TranscriptSessionIdContext = createContext<string | null>(null);
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
  return (
    <TranscriptSessionIdContext.Provider value={sessionId}>
      <TranscriptOpenSessionContext.Provider value={onOpenSession ?? null}>
        <TranscriptCanOpenSessionContext.Provider value={canOpenSession ?? null}>
          {children}
        </TranscriptCanOpenSessionContext.Provider>
      </TranscriptOpenSessionContext.Provider>
    </TranscriptSessionIdContext.Provider>
  );
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
