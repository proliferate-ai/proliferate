export type TranscriptOpenSessionRole =
  | "agent-parent"
  | "cowork-coding-child"
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
  linkedSessionWorkspaces?: Record<string, string | null | undefined>;
  contextWorkspaces?: Array<TranscriptOpenSessionWorkspace | null | undefined>;
}

export function resolveTranscriptOpenSessionWorkspaceId({
  sessionId,
  role,
  sessionSlots,
  fallbackWorkspaceId,
  linkedSessionWorkspaces = {},
  contextWorkspaces = [],
}: ResolveTranscriptOpenSessionWorkspaceInput): string | null {
  const slotWorkspaceId = sessionSlots[sessionId]?.workspaceId?.trim();
  if (slotWorkspaceId) {
    return slotWorkspaceId;
  }

  const linkedWorkspaceId = linkedSessionWorkspaces[sessionId]?.trim();
  if (linkedWorkspaceId) {
    return linkedWorkspaceId;
  }

  if (role === "cowork-coding-child") {
    return null;
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
