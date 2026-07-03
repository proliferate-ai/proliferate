import { Navigate, useParams } from "react-router-dom";
import { WorkflowEditorScreen } from "@/components/workflows/screen/WorkflowEditorScreen";

export function WorkflowEditorPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  if (!workflowId) {
    return <Navigate to="/workflows" replace />;
  }
  return <WorkflowEditorScreen workflowId={workflowId} />;
}
