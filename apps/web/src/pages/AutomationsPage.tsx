import { useParams } from "react-router-dom";

import { AutomationsScreen } from "../components/automations/screen/AutomationsScreen";

export function AutomationsPage() {
  const { automationId } = useParams();
  return <AutomationsScreen selectedAutomationId={automationId ?? null} />;
}
