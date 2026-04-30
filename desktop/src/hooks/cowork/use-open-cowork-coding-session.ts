import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";

export function useOpenCoworkCodingSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectWorkspace } = useWorkspaceSelection();

  return useCallback(async (input: {
    workspaceId: string;
    sessionId: string;
  }) => {
    if (location.pathname !== "/") {
      navigate("/");
    }
    await selectWorkspace(input.workspaceId, {
      force: true,
      initialActiveSessionId: input.sessionId,
    });
  }, [location.pathname, navigate, selectWorkspace]);
}
