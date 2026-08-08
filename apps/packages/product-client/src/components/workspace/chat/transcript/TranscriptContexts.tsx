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
/**
 * The workspace this transcript's session lives in. Receipts read it to tell a
 * spawn that landed HERE from one that landed elsewhere: ADR §4 scopes the
 * "— in {workspace}" suffix to the cross-workspace case, so a same-workspace
 * spawn must not repeat the workspace the reader is already looking at.
 */
const TranscriptWorkspaceIdContext = createContext<string | null>(null);

export function TranscriptContextProviders({
  sessionId,
  workspaceId = null,
  onOpenSession,
  canOpenSession,
  onOpenWorkspace,
  children,
}: {
  sessionId: string;
  workspaceId?: string | null;
  onOpenSession?: TranscriptOpenSessionHandler;
  canOpenSession?: (sessionId: string, role?: TranscriptOpenSessionRole) => boolean;
  onOpenWorkspace?: (workspaceId: string) => void;
  children: ReactNode;
}) {
  return (
    <TranscriptWorkspaceIdContext.Provider value={workspaceId}>
    <TranscriptSessionIdContext.Provider value={sessionId}>
      <TranscriptOpenSessionContext.Provider value={onOpenSession ?? null}>
        <TranscriptCanOpenSessionContext.Provider value={canOpenSession ?? null}>
          <TranscriptOpenWorkspaceContext.Provider value={onOpenWorkspace ?? null}>
            {children}
          </TranscriptOpenWorkspaceContext.Provider>
        </TranscriptCanOpenSessionContext.Provider>
      </TranscriptOpenSessionContext.Provider>
    </TranscriptSessionIdContext.Provider>
    </TranscriptWorkspaceIdContext.Provider>
  );
}

export function useTranscriptWorkspaceId(): string | null {
  return useContext(TranscriptWorkspaceIdContext);
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
