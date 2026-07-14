import { useLocation, useNavigate, useParams } from "react-router-dom";
import { WorkflowDefinitionsSurface } from "@proliferate/product-surfaces/workflows/WorkflowDefinitionsSurface";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { WorkflowDefinitionsAccessScreen } from "@/components/workflows/definitions/WorkflowDefinitionsAccessScreen";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { APP_ROUTES } from "@/config/app-routes";
import { WORKFLOW_AUTH_COPY } from "@/copy/workflows/workflow-copy";

export function WorkflowsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const auth = useProductHost().auth;
  const authState = auth.state;
  const authStatus = authState.status;
  const authUserId = authState.status === "authenticated"
    ? authState.user?.id ?? null
    : null;

  if (!auth.authRequired) {
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
