import { useLocation, useNavigate, useParams } from "react-router-dom";
import { WorkflowDefinitionsSurface } from "@proliferate/product-surfaces/workflows/WorkflowDefinitionsSurface";
import { WorkflowDefinitionsAccessScreen } from "#product/components/workflows/definitions/WorkflowDefinitionsAccessScreen";
import { MainSidebarPageShell } from "#product/components/workspace/shell/screen/MainSidebarPageShell";
import { APP_ROUTES } from "#product/config/app-routes";
import { WORKFLOW_AUTH_COPY } from "#product/copy/workflows/workflow-copy";
import { isDevAuthBypassed } from "#product/lib/domain/auth/auth-mode";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "#product/hooks/auth/facade/use-product-auth";

export function WorkflowsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const authStatus = useProductAuthStatus();
  const authUserId = useProductAuthUserId();

  if (isDevAuthBypassed()) {
    return (
      <WorkflowDefinitionsAccessScreen
        title={WORKFLOW_AUTH_COPY.devBypassTitle}
        description={WORKFLOW_AUTH_COPY.devBypassDescription}
      />
    );
  }

  if (authStatus !== "authenticated") {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <WorkflowDefinitionsAccessScreen
        title={WORKFLOW_AUTH_COPY.signInTitle}
        description={WORKFLOW_AUTH_COPY.signInDescription}
        actionLabel={WORKFLOW_AUTH_COPY.signInAction}
        onAction={() => navigate("/login", { state: { from: returnTo } })}
      />
    );
  }

  if (!authUserId) {
    return (
      <WorkflowDefinitionsAccessScreen
        title={WORKFLOW_AUTH_COPY.identityUnavailableTitle}
        description={WORKFLOW_AUTH_COPY.identityUnavailableDescription}
      />
    );
  }

  return (
    <MainSidebarPageShell>
      <WorkflowDefinitionsSurface
        authCacheScope={authUserId}
        selectedWorkflowId={workflowId ?? null}
        onSelectWorkflow={(id) => navigate(`${APP_ROUTES.workflows}/${encodeURIComponent(id)}`)}
        onBackToList={() => navigate(APP_ROUTES.workflows)}
      />
    </MainSidebarPageShell>
  );
}
