import { useNavigate, useParams } from "react-router-dom";
import { RedirectCallbackScreen } from "#product/components/auth/RedirectCallbackScreen";
import { APP_ROUTES } from "#product/config/app-routes";

/**
 * Cloud culling (PRO-10, Rung 1): `workspaces/:workspaceId` deep links carried
 * cloud workspace ids into a cloud-workspace open flow. With cloud surfaces
 * culled, these deep links resolve to a neutral not-found state — never a
 * crash and never a cloud pane (FR-2, FM4). The cloud open hooks stay in the
 * codebase dormant; this page simply no longer reaches them.
 */
export function DesktopWorkspaceDeepLinkPage() {
  // `workspaceId` is intentionally ignored: every deep-link workspace id now
  // resolves to the same neutral not-found terminal state.
  useParams();
  const navigate = useNavigate();

  return (
    <RedirectCallbackScreen
      title="Workspace not found"
      description="This workspace is no longer available."
      statusLabel="Workspace not found"
      variant="handoff"
      primaryAction={{
        label: "Go home",
        onClick: () => navigate(APP_ROUTES.home, { replace: true }),
      }}
    />
  );
}
