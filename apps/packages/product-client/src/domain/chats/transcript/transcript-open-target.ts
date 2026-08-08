export type TranscriptOpenSessionRole =
  | "agent-parent"
  | "linked-child"
  | "generic";

type TranscriptOpenSessionSlot = {
  workspaceId: string | null;
};

type TranscriptOpenSessionCreatorContext =
  | {
      kind: "agent";
      sourceSessionId?: string | null;
      sourceSessionWorkspaceId?: string | null;
    }
  | { kind: string };

type TranscriptOpenSessionWorkspace = {
  creatorContext?: TranscriptOpenSessionCreatorContext | null;
};

export interface ResolveTranscriptOpenSessionWorkspaceInput {
  sessionId: string;
  role: TranscriptOpenSessionRole;
  sessionSlots: Record<string, TranscriptOpenSessionSlot | undefined>;
  fallbackWorkspaceId: string | null;
  contextWorkspaces?: Array<TranscriptOpenSessionWorkspace | null | undefined>;
}

export function resolveTranscriptOpenSessionWorkspaceId({
  sessionId,
  role,
  sessionSlots,
  fallbackWorkspaceId,
  contextWorkspaces = [],
}: ResolveTranscriptOpenSessionWorkspaceInput): string | null {
  const slotWorkspaceId = sessionSlots[sessionId]?.workspaceId?.trim();
  if (slotWorkspaceId) {
    return slotWorkspaceId;
  }

  if (role === "agent-parent") {
    for (const workspace of contextWorkspaces) {
      const creatorContext = workspace?.creatorContext;
      if (
        creatorContext?.kind === "agent"
        && "sourceSessionId" in creatorContext
        && creatorContext.sourceSessionId?.trim() === sessionId
      ) {
        return "sourceSessionWorkspaceId" in creatorContext
          ? creatorContext.sourceSessionWorkspaceId?.trim() || null
          : null;
      }
    }

    return null;
  }

  return fallbackWorkspaceId?.trim() || null;
}
