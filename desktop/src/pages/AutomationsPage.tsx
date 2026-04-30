import { Navigate } from "react-router-dom";
import { AutomationsScreen } from "@/components/automations/AutomationsScreen";
import { automationsUiEnabled } from "@/config/automations";

export function AutomationsPage() {
  if (!automationsUiEnabled()) {
    return <Navigate to="/" replace />;
  }
  return <AutomationsScreen />;
}
