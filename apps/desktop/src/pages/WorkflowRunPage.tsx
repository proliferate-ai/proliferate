import { Navigate, useParams } from "react-router-dom";
import { WorkflowRunScreen } from "@/components/workflows/screen/WorkflowRunScreen";

export function WorkflowRunPage() {
  const { workflowId, runId } = useParams<{ workflowId: string; runId: string }>();
  if (!workflowId || !runId) {
    return <Navigate to="/workflows" replace />;
  }
  return <WorkflowRunScreen workflowId={workflowId} runId={runId} />;
}
