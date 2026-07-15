import type {
  AgentGatewayCapabilities,
  AgentGatewayEnrollment,
} from "@proliferate/cloud-sdk";

export function gatewaySubtitle(
  capabilities: AgentGatewayCapabilities | undefined,
  enrollment: AgentGatewayEnrollment | undefined,
): string {
  if (capabilities && !capabilities.gatewayEnabled) {
    return "Unavailable for your account";
  }
  if (enrollment?.syncStatus === "failed") {
    return enrollment.lastErrorCode
      ? `Enrollment failed (${enrollment.lastErrorCode})`
      : "Enrollment failed";
  }
  if (enrollment?.syncStatus === "pending") {
    return "Enrollment pending";
  }
  return "Proliferate-managed model access. No setup required.";
}
