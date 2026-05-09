import type { Session, SessionActionCapabilities } from "@anyharness/sdk";

export interface SessionDebugLocatorSession {
  id: string;
  owningWorkspaceId: string | null;
  agentKind: string | null;
  status: string | null;
  title: string | null;
  modelId: string | null;
  modeId: string | null;
  nativeSessionId: string | null;
  actionCapabilities: SessionActionCapabilities | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function sessionLocatorFromSession(session: Session): SessionDebugLocatorSession {
  return {
    id: session.id,
    owningWorkspaceId: session.workspaceId,
    agentKind: session.agentKind,
    status: session.status,
    title: session.title ?? null,
    modelId: session.modelId ?? session.requestedModelId ?? null,
    modeId: session.modeId ?? session.requestedModeId ?? null,
    nativeSessionId: session.nativeSessionId ?? null,
    actionCapabilities: session.actionCapabilities ?? null,
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
  };
}
