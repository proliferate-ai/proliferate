import { useNavigate, useParams } from "react-router-dom";
import { WorkflowDefinitionsSurface } from "@proliferate/product-surfaces/workflows/WorkflowDefinitionsSurface";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";
import { APP_ROUTES } from "@/config/app-routes";
import { useAuthStore } from "@/stores/auth/auth-store";

export function WorkflowsPage() {
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const authCacheScope = useAuthStore((state) => state.user?.id ?? "authenticated-session");
  return (
    <MainSidebarPageShell>
      <WorkflowDefinitionsSurface
        authCacheScope={authCacheScope}
        selectedWorkflowId={workflowId ?? null}
        onSelectWorkflow={(id) => navigate(`${APP_ROUTES.workflows}/${encodeURIComponent(id)}`)}
        onBackToList={() => navigate(APP_ROUTES.workflows)}
      />
    </MainSidebarPageShell>
  );
}
