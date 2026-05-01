import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/use-workspace-activation-workflow";

export function useOpenCoworkCodingSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();

  return useCallback(async (input: {
    workspaceId: string;
    sessionId: string;
  }) => {
    if (location.pathname !== "/") {
      navigate("/");
    }
    await openWorkspaceSession({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      forceWorkspaceSelection: true,
    });
  }, [location.pathname, navigate, openWorkspaceSession]);
}
