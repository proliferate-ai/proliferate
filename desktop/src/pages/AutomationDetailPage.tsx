import { useParams } from "react-router-dom";
import { AutomationsScreen } from "@/components/automations/screen/AutomationsScreen";

export function AutomationDetailPage() {
  const { automationId } = useParams<{ automationId: string }>();
  return <AutomationsScreen selectedAutomationId={automationId ?? null} />;
}
