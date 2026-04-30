import { useParams } from "react-router-dom";
import { AutomationsScreen } from "@/components/automations/AutomationsScreen";

export function AutomationDetailPage() {
  const { automationId } = useParams<{ automationId: string }>();
  return <AutomationsScreen selectedAutomationId={automationId ?? null} />;
}
