import { useLocation, useNavigate, useParams } from "react-router-dom";
import { WorkflowDefinitionsSurface } from "@proliferate/product-surfaces/workflows/WorkflowDefinitionsSurface";
import { WorkflowRunsSurface } from "@proliferate/product-surfaces/workflows/WorkflowRunsSurface";
import { WorkflowDefinitionsAccessScreen } from "#product/components/workflows/definitions/WorkflowDefinitionsAccessScreen";
import { MainSidebarPageShell } from "#product/components/workspace/shell/screen/MainSidebarPageShell";
import { APP_ROUTES, workflowRunRoute } from "#product/config/app-routes";
import { WORKFLOW_AUTH_COPY } from "#product/copy/workflows/workflow-copy";
import { isDevAuthBypassed } from "#product/lib/domain/auth/auth-mode";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "#product/hooks/auth/facade/use-product-auth";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useWorkflowRunOpenActions } from "#product/hooks/workflows/workflows/use-workflow-run-open-actions";

export function WorkflowsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { workflowId, runId } = useParams<{ workflowId: string; runId: string }>();
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

  return <AuthenticatedWorkflowsPage authUserId={authUserId} workflowId={workflowId} runId={runId} />;
}

function AuthenticatedWorkflowsPage({
  authUserId,
  workflowId,
  runId,
}: {
  authUserId: string;
  workflowId?: string;
  runId?: string;
}) {
  const navigate = useNavigate();
  const capabilities = useAppCapabilities();
  const { openWorkflowRunSession } = useWorkflowRunOpenActions();

  return (
    <MainSidebarPageShell>
      {workflowId && runId ? (
        <WorkflowRunsSurface
          authCacheScope={authUserId}
          workflowDefinitionId={workflowId}
          runId={runId}
          managedRunsEnabled={capabilities.workflowManagedRunsEnabled}
          onBack={() => navigate(`${APP_ROUTES.workflows}/${encodeURIComponent(workflowId)}`)}
          onOpenSession={openWorkflowRunSession}
        />
      ) : (
        <WorkflowDefinitionsSurface
          authCacheScope={authUserId}
          selectedWorkflowId={workflowId ?? null}
          managedRunsEnabled={capabilities.workflowManagedRunsEnabled}
          onSelectWorkflow={(id) => navigate(`${APP_ROUTES.workflows}/${encodeURIComponent(id)}`)}
          onOpenRun={(definitionId, invocationId) => navigate(workflowRunRoute(definitionId, invocationId))}
          onBackToList={() => navigate(APP_ROUTES.workflows)}
        />
      )}
    </MainSidebarPageShell>
  );
}
