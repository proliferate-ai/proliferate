import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";
import { APP_ROUTES } from "@/config/app-routes";
import { useCloudWorkspaceActions } from "@/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useToastStore } from "@/stores/toast/toast-store";

const DEEP_LINK_TIMEOUT_MS = 12000;

export function DesktopWorkspaceDeepLinkPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();
  const showToast = useToastStore((state) => state.show);
  const [handoffTimedOut, setHandoffTimedOut] = useState(false);
  const [openAttempt, setOpenAttempt] = useState(0);

  const retryOpenWorkspace = useCallback(() => {
    setHandoffTimedOut(false);
    setOpenAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      navigate(APP_ROUTES.workspaces, { replace: true });
      return;
    }

    setHandoffTimedOut(false);

    let active = true;
    const timeoutId = window.setTimeout(() => {
      if (!active) {
        return;
      }
      setHandoffTimedOut(true);
      captureTelemetryException(
        new Error("Desktop workspace deep link did not finish before timeout"),
        {
          level: "warning",
          tags: {
            action: "open_workspace_deep_link",
            domain: "cloud_workspace",
          },
        },
      );
    }, DEEP_LINK_TIMEOUT_MS);

    void refreshCloudWorkspace(workspaceId)
      .then((workspace) => {
        if (!active) {
          return;
        }
        window.clearTimeout(timeoutId);
        selectWorkspaceFromSurface(
          cloudWorkspaceSyntheticId(workspace.id),
          "desktop_deep_link",
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        window.clearTimeout(timeoutId);
        captureTelemetryException(error, {
          tags: {
            action: "open_workspace_deep_link",
            domain: "cloud_workspace",
          },
        });
        const message = error instanceof Error ? error.message : "Failed to open workspace.";
        showToast(message);
        navigate(APP_ROUTES.workspaces, { replace: true });
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    openAttempt,
    navigate,
    refreshCloudWorkspace,
    selectWorkspaceFromSurface,
    showToast,
    workspaceId,
  ]);

  if (handoffTimedOut) {
    return (
      <RedirectCallbackScreen
        title="Workspace did not open"
        description="Desktop is still trying to open this cloud workspace, but the handoff has taken longer than expected."
        statusLabel="Workspace deep link waiting"
        primaryAction={{
          label: "Try opening workspace again",
          onClick: retryOpenWorkspace,
        }}
        secondaryAction={{
          label: "View workspaces",
          onClick: () => navigate(APP_ROUTES.workspaces, { replace: true }),
        }}
      />
    );
  }

  return (
    <RedirectCallbackScreen
      title="Opening workspace"
      description="Bringing this cloud workspace into Desktop."
      statusLabel="Workspace deep link"
      variant="handoff"
    />
  );
}
