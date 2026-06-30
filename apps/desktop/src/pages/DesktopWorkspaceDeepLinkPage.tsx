import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";
import { APP_ROUTES } from "@/config/app-routes";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useToastStore } from "@/stores/toast/toast-store";

export function DesktopWorkspaceDeepLinkPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();
  const showToast = useToastStore((state) => state.show);

  useEffect(() => {
    if (!workspaceId) {
      navigate(APP_ROUTES.home, { replace: true });
      return;
    }

    let active = true;
    void refreshCloudWorkspace(workspaceId)
      .then((workspace) => {
        if (!active) {
          return;
        }
        selectWorkspaceFromSurface(
          cloudWorkspaceSyntheticId(workspace.id),
          "desktop_deep_link",
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to open workspace.";
        showToast(message);
        navigate(APP_ROUTES.home, { replace: true });
      });

    return () => {
      active = false;
    };
  }, [
    navigate,
    refreshCloudWorkspace,
    selectWorkspaceFromSurface,
    showToast,
    workspaceId,
  ]);

  return (
    <RedirectCallbackScreen
      title="Opening workspace"
      description="Bringing this cloud workspace into Desktop."
      statusLabel="Workspace deep link"
      variant="handoff"
    />
  );
}
