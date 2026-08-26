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
  if (capabilities?.creditsExhausted) {
    // AA-3: the server withholds the gateway key when the paying subject is
    // out of LLM credits, and the runtime then refuses launches with a
    // generic selection-missing error. Name the real reason here.
    return "Out of LLM credits — gateway launches are paused until credits are added";
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
