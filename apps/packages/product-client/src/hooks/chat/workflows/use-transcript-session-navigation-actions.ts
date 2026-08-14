import { useCallback, useMemo } from "react";
import type { TranscriptState } from "@anyharness/sdk";
import { useCoworkManagedWorkspaces } from "#product/hooks/access/anyharness/cowork/use-cowork-managed-workspaces";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import {
  resolveTranscriptOpenSessionWorkspaceId,
  type TranscriptOpenSessionRole,
} from "#product/domain/chats/transcript/transcript-open-target";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  getSessionRecord,
  getSessionRecords,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function useTranscriptSessionNavigationActions(input: {
  sourceSessionId: string | null;
  fallbackWorkspaceId: string | null;
  transcript: TranscriptState | null;
}) {
  const { activateChatTab } = useWorkspaceShellActivation();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { data: workspaceCollections } = useWorkspaces();
  const selectedWorkspace = useMemo(
    () => input.fallbackWorkspaceId
      ? workspaceCollections?.allWorkspaces.find(
        (workspace) => workspace.id === input.fallbackWorkspaceId,
      ) ?? null
      : null,
    [input.fallbackWorkspaceId, workspaceCollections?.allWorkspaces],
  );
  const selectedCloudWorkspace = useMemo(() => {
    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(input.fallbackWorkspaceId);
    return cloudWorkspaceId
      ? workspaceCollections?.cloudWorkspaces.find(
        (workspace) => workspace.id === cloudWorkspaceId,
      ) ?? null
      : null;
  }, [input.fallbackWorkspaceId, workspaceCollections?.cloudWorkspaces]);
  const linkCompletionsByCompletionId = input.transcript?.linkCompletionsByCompletionId;
  const hasCoworkCodingCompletions = useMemo(
    () => linkCompletionsByCompletionId
      ? Object.values(linkCompletionsByCompletionId).some(
        (completion) => completion.relation === "cowork_coding_session",
      )
      : false,
    [linkCompletionsByCompletionId],
  );
  const { workspaces: coworkManagedWorkspaces } = useCoworkManagedWorkspaces(
    input.sourceSessionId,
    hasCoworkCodingCompletions,
  );
  const linkedSessionWorkspaces = useMemo(() => Object.fromEntries(
    coworkManagedWorkspaces.flatMap((workspace) =>
      workspace.sessions.map((session) => [
        session.codingSessionId,
        workspace.workspaceId,
      ] as const)
    ),
  ), [coworkManagedWorkspaces]);

  const resolveOpenSessionWorkspaceId = useCallback((
    sessionId: string,
    role: TranscriptOpenSessionRole = "generic",
  ) => {
    const sourceRecord = input.sourceSessionId
      ? getSessionRecord(input.sourceSessionId)
      : null;
    return resolveTranscriptOpenSessionWorkspaceId({
      sessionId,
      role,
      sessionSlots: getSessionRecords(),
      fallbackWorkspaceId: input.sourceSessionId
        ? sourceRecord?.workspaceId ?? input.fallbackWorkspaceId
        : input.fallbackWorkspaceId,
      linkedSessionWorkspaces,
      contextWorkspaces: [selectedWorkspace, selectedCloudWorkspace],
    });
  }, [
    input.fallbackWorkspaceId,
    input.sourceSessionId,
    linkedSessionWorkspaces,
    selectedCloudWorkspace,
    selectedWorkspace,
  ]);

  const canOpenTranscriptSession = useCallback((
    sessionId: string,
    role: TranscriptOpenSessionRole = "generic",
  ) => resolveOpenSessionWorkspaceId(sessionId, role) !== null, [resolveOpenSessionWorkspaceId]);
  const openTranscriptSession = useCallback((
    sessionId: string,
    role: TranscriptOpenSessionRole = "generic",
  ) => {
    const workspaceId = resolveOpenSessionWorkspaceId(sessionId, role);
    if (!workspaceId) return;
    if (workspaceId === useSessionSelectionStore.getState().selectedWorkspaceId) {
      void activateChatTab({
        workspaceId,
        sessionId,
        source: "session-transcript-pane",
      });
      return;
    }
    void openWorkspaceSession({ workspaceId, sessionId });
  }, [activateChatTab, openWorkspaceSession, resolveOpenSessionWorkspaceId]);

  return { canOpenTranscriptSession, openTranscriptSession };
}
