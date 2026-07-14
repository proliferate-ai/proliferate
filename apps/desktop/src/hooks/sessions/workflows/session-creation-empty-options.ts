import type {
  CreateEmptySessionWithResolvedConfigOptions,
  CreateSessionWithResolvedConfigOptions,
} from "@/hooks/sessions/workflows/session-creation-types";

export function toEmptySessionCreateOptions(
  options: CreateEmptySessionWithResolvedConfigOptions,
): CreateSessionWithResolvedConfigOptions {
  return {
    text: "",
    agentKind: options.agentKind,
    modelId: options.modelId,
    modeId: options.modeId,
    launchControlValues: options.launchControlValues,
    workspaceId: options.workspaceId,
    latencyFlowId: options.latencyFlowId,
    clientSessionId: options.clientSessionId,
    reuseInFlightEmptySession: options.reuseInFlightEmptySession,
    preserveProjectedSessionOnCreateFailure: options.preserveProjectedSessionOnCreateFailure,
    replacesSessionId: options.replacesSessionId,
  };
}
