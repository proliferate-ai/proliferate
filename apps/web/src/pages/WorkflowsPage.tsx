import { useParams } from "react-router-dom";

import { AutomationsScreen } from "../components/automations/screen/AutomationsScreen";

export function WorkflowsPage() {
  const { workflowId } = useParams();
  return <AutomationsScreen selectedAutomationId={workflowId ?? null} />;
}
