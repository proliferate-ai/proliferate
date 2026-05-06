import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/use-workspace-activation-workflow";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

export function useOpenCoworkCodingSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const recordSessionRelationshipHint = useSessionDirectoryStore(
    (state) => state.recordRelationshipHint,
  );

  return useCallback(async (input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => {
    if (location.pathname !== "/") {
      navigate("/");
    }
    recordSessionRelationshipHint(input.sessionId, {
      kind: "cowork_child",
      parentSessionId: input.parentSessionId ?? null,
      sessionLinkId: input.sessionLinkId ?? null,
      relation: "cowork_coding_session",
      workspaceId: input.workspaceId,
    });
    await openWorkspaceSession({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      forceWorkspaceSelection: true,
    });
  }, [location.pathname, navigate, openWorkspaceSession, recordSessionRelationshipHint]);
}
