import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";

export type TranscriptOpenSessionHandler = (
  sessionId: string,
  role?: TranscriptOpenSessionRole,
) => void;

const TranscriptSessionIdContext = createContext<string | null>(null);
const TranscriptOpenSessionContext = createContext<TranscriptOpenSessionHandler | null>(null);
const TranscriptCanOpenSessionContext = createContext<
  ((sessionId: string, role?: TranscriptOpenSessionRole) => boolean) | null
>(null);
/**
 * Switching to a workspace an agent created. Supplied by the shell; null
 * anywhere the transcript renders without one, where the receipt simply has no
 * Open to offer.
 */
const TranscriptOpenWorkspaceContext = createContext<((workspaceId: string) => void) | null>(null);

export function TranscriptContextProviders({
  sessionId,
  onOpenSession,
  canOpenSession,
  onOpenWorkspace,
  children,
}: {
  sessionId: string;
  onOpenSession?: TranscriptOpenSessionHandler;
  canOpenSession?: (sessionId: string, role?: TranscriptOpenSessionRole) => boolean;
  onOpenWorkspace?: (workspaceId: string) => void;
  children: ReactNode;
}) {
  return (
    <TranscriptSessionIdContext.Provider value={sessionId}>
      <TranscriptOpenSessionContext.Provider value={onOpenSession ?? null}>
        <TranscriptCanOpenSessionContext.Provider value={canOpenSession ?? null}>
          <TranscriptOpenWorkspaceContext.Provider value={onOpenWorkspace ?? null}>
            {children}
          </TranscriptOpenWorkspaceContext.Provider>
        </TranscriptCanOpenSessionContext.Provider>
      </TranscriptOpenSessionContext.Provider>
    </TranscriptSessionIdContext.Provider>
  );
}

export function useTranscriptOpenWorkspace(): ((workspaceId: string) => void) | null {
  return useContext(TranscriptOpenWorkspaceContext);
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
