import { Navigate, useParams } from "react-router-dom";
import { AutomationsScreen } from "@/components/automations/AutomationsScreen";
import { automationsUiEnabled } from "@/config/automations";

export function AutomationDetailPage() {
  const { automationId } = useParams<{ automationId: string }>();
  if (!automationsUiEnabled()) {
    return <Navigate to="/" replace />;
  }
  return <AutomationsScreen selectedAutomationId={automationId ?? null} />;
}
