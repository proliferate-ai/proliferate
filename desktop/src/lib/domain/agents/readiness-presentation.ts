import type { AgentReadinessState } from "@anyharness/sdk";

export const AGENT_READINESS_LABELS: Record<AgentReadinessState, string> = {
  ready: "Configured",
  install_required: "Install required",
  credentials_required: "Credentials required",
  login_required: "Login required",
  unsupported: "Unsupported",
  error: "Unavailable",
};
