import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { WorkflowBuilderSurface } from "#product/components/workflows/builder-v2/WorkflowBuilderSurface";
import { WorkflowDefinitionsAccessScreen } from "#product/components/workflows/definitions/WorkflowDefinitionsAccessScreen";
import { WorkflowsMainSurface } from "#product/components/workflows/main/WorkflowsMainSurface";
import { WorkflowResourceState } from "#product/components/workflows/WorkflowResourceState";
import { MainSidebarPageShell } from "#product/components/workspace/shell/screen/MainSidebarPageShell";
import { APP_ROUTES } from "#product/config/app-routes";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_AUTH_COPY } from "#product/copy/workflows/workflow-copy";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { isDevAuthBypassed } from "#product/lib/domain/auth/auth-mode";
import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";
import {
  useProductAuthStatus,
  useProductAuthUserId,
} from "#product/hooks/auth/facade/use-product-auth";

/**
 * Sentinel `workflowId` for "start a new workflow" (real definition ids are
 * server-minted UUIDs, so this literal never collides with one).
 */
const NEW_WORKFLOW_ID = "new";

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
  const location = useLocation();

  // Gen-1 is deleted outright; while the launch flag is off the feature ships
  // dark rather than falling back to any earlier surface.
  if (!isWorkflowsV2Enabled()) {
    return (
      <MainSidebarPageShell>
        <WorkflowResourceState
          title={WORKFLOW_MAIN_COPY.unavailableTitle}
          description={WORKFLOW_MAIN_COPY.unavailableDescription}
          onBack={() => navigate(APP_ROUTES.home)}
        />
      </MainSidebarPageShell>
    );
  }

  // Gen-1's per-run route has no v2 equivalent: a v2 run lives in its
  // workspace's right panel (`WorkflowPane`), not a standalone page.
  if (runId) {
    return <Navigate to={APP_ROUTES.workflows} replace />;
  }

  if (workflowId) {
    const isNew = workflowId === NEW_WORKFLOW_ID;
    const state = location.state as { template?: WorkflowStarterTemplateV2 } | null;
    return (
      <MainSidebarPageShell>
        <WorkflowBuilderSurface
          definitionId={isNew ? null : workflowId}
          template={isNew ? state?.template ?? null : null}
          authCacheScope={authUserId}
          onSaved={(definitionId) =>
            navigate(`${APP_ROUTES.workflows}/${encodeURIComponent(definitionId)}`)}
          onBack={() => navigate(APP_ROUTES.workflows)}
        />
      </MainSidebarPageShell>
    );
  }

  return (
    <MainSidebarPageShell>
      <WorkflowsMainSurface
        authCacheScope={authUserId}
        onEdit={(definitionId) =>
          navigate(`${APP_ROUTES.workflows}/${encodeURIComponent(definitionId)}`)}
        onNew={(template) =>
          navigate(`${APP_ROUTES.workflows}/${NEW_WORKFLOW_ID}`, {
            state: template ? { template } : undefined,
          })}
      />
    </MainSidebarPageShell>
  );
}
