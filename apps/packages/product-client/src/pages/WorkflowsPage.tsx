import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { WorkflowDefinitionsSurface } from "@proliferate/product-surfaces/workflows/WorkflowDefinitionsSurface";
import { WorkflowRunsSurface } from "@proliferate/product-surfaces/workflows/WorkflowRunsSurface";
import { WorkflowDefinitionsAccessScreen } from "#product/components/workflows/definitions/WorkflowDefinitionsAccessScreen";
import { WorkflowsBetaGateModal } from "#product/components/workflows/WorkflowsBetaGateModal";
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

/**
 * TEMPORARY (workflows beta gate). While workflows are unfinished, entering
 * this surface raises a "this feature is in beta" modal over the real page so
 * nobody wanders in unaware. Flip this to `false` (or delete it together with
 * WorkflowsBetaGateModal and WORKFLOW_BETA_COPY) to remove the gate — nothing
 * else in the workflows stack is conditioned on it.
 */
const WORKFLOWS_BETA_GATE_ENABLED = true;

// TEMPORARY (workflows beta gate). The acknowledgement is scoped to the browser
// session so the notice is shown once per app session rather than on every
// mount: the surface remounts on reload and on each workflows route change, and
// re-raising the same notice there would be nagging rather than informative.
const WORKFLOWS_BETA_GATE_STORAGE_KEY = "proliferate.workflows-beta-gate.acknowledged";

function readBetaGateAcknowledged(): boolean {
  try {
    return window.sessionStorage.getItem(WORKFLOWS_BETA_GATE_STORAGE_KEY) === "1";
  } catch {
    // Storage can be unavailable (privacy modes, embedded webviews). Falling
    // back to "not acknowledged" keeps the notice visible, which is the safe
    // direction for a beta warning.
    return false;
  }
}

function persistBetaGateAcknowledged(): void {
  try {
    window.sessionStorage.setItem(WORKFLOWS_BETA_GATE_STORAGE_KEY, "1");
  } catch {
    // Best-effort only; the in-memory state below still dismisses the notice.
  }
}

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
  // TEMPORARY (workflows beta gate): once-per-browser-session acknowledgement.
  const [betaGateAcknowledged, setBetaGateAcknowledged] = useState(readBetaGateAcknowledged);

  return (
    <MainSidebarPageShell>
      {WORKFLOWS_BETA_GATE_ENABLED ? (
        <WorkflowsBetaGateModal
          open={!betaGateAcknowledged}
          onContinue={() => {
            persistBetaGateAcknowledged();
            setBetaGateAcknowledged(true);
          }}
          onLeave={() => navigate(APP_ROUTES.home)}
        />
      ) : null}
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
