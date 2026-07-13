import { useNavigate, useParams } from "react-router-dom";
import { WorkflowDefinitionsSurface } from "@proliferate/product-surfaces/workflows/WorkflowDefinitionsSurface";
import { routes } from "../config/routes";
import { useAuthToken } from "../providers/WebCloudProvider";

export function WorkflowsPage() {
  const navigate = useNavigate();
  const { workflowId } = useParams();
  const { user } = useAuthToken();
  return (
    <WorkflowDefinitionsSurface
      authCacheScope={user?.id ?? "web-authenticated-session"}
      selectedWorkflowId={workflowId ?? null}
      onSelectWorkflow={(id) => navigate(routes.workflow(id))}
      onBackToList={() => navigate(routes.workflows)}
    />
  );
}
