import type { components } from "../generated/openapi.js";

type GeneratedNormalizedSessionControls =
  components["schemas"]["NormalizedSessionControls"];
type GeneratedSessionLiveConfigSnapshot =
  components["schemas"]["SessionLiveConfigSnapshot"];
type GeneratedGetSessionLiveConfigResponse =
  components["schemas"]["GetSessionLiveConfigResponse"];
type GeneratedSetSessionConfigOptionResponse =
  components["schemas"]["SetSessionConfigOptionResponse"];
type GeneratedSession = components["schemas"]["Session"];
type GeneratedPromptSessionResponse =
  components["schemas"]["PromptSessionResponse"];

export type SessionStatus = components["schemas"]["SessionStatus"];
export type SessionExecutionPhase = components["schemas"]["SessionExecutionPhase"];
export type PendingApprovalSummary = components["schemas"]["PendingApprovalSummary"];
export type SessionExecutionSummary = components["schemas"]["SessionExecutionSummary"];
export type Session = Omit<GeneratedSession, "liveConfig"> & {
  liveConfig?: SessionLiveConfigSnapshot | null;
};
export type CreateSessionRequest = components["schemas"]["CreateSessionRequest"];
export type SessionMcpEnvVar = components["schemas"]["SessionMcpEnvVar"];
export type SessionMcpHeader = components["schemas"]["SessionMcpHeader"];
export type SessionMcpHttpServer = components["schemas"]["SessionMcpHttpServer"];
export type SessionMcpStdioServer = components["schemas"]["SessionMcpStdioServer"];
export type SessionMcpServer = components["schemas"]["SessionMcpServer"];
export type UpdateSessionTitleRequest =
  components["schemas"]["UpdateSessionTitleRequest"];
export type RawSessionConfigValue = components["schemas"]["RawSessionConfigValue"];
export type SessionConfigOptionType =
  components["schemas"]["SessionConfigOptionType"];
export type RawSessionConfigOption = components["schemas"]["RawSessionConfigOption"];
export type NormalizedSessionControlValue =
  components["schemas"]["NormalizedSessionControlValue"];
export type NormalizedSessionControl =
  components["schemas"]["NormalizedSessionControl"];
export type NormalizedSessionControls = Omit<
  GeneratedNormalizedSessionControls,
  "extras"
> & {
  extras: NormalizedSessionControl[];
};
export type SessionLiveConfigSnapshot = Omit<
  GeneratedSessionLiveConfigSnapshot,
  "normalizedControls"
> & {
  normalizedControls: NormalizedSessionControls;
};
export type GetSessionLiveConfigResponse = Omit<
  GeneratedGetSessionLiveConfigResponse,
  "liveConfig"
> & {
  liveConfig?: SessionLiveConfigSnapshot | null;
};
export type SetSessionConfigOptionRequest =
  components["schemas"]["SetSessionConfigOptionRequest"];
export type ConfigApplyState = components["schemas"]["ConfigApplyState"];
export type SetSessionConfigOptionResponse = Omit<
  GeneratedSetSessionConfigOptionResponse,
  "liveConfig" | "session"
> & {
  liveConfig?: SessionLiveConfigSnapshot | null;
  session: Session;
};
export type PromptInputBlock = components["schemas"]["PromptInputBlock"];
export type PromptSessionRequest = components["schemas"]["PromptSessionRequest"];
export type PromptSessionStatus = components["schemas"]["PromptSessionStatus"];
export type PromptSessionResponse = Omit<
  GeneratedPromptSessionResponse,
  "session"
> & {
  session: Session;
};
export type PendingPromptSummary = components["schemas"]["PendingPromptSummary"];
export type EditPendingPromptRequest =
  components["schemas"]["EditPendingPromptRequest"];
export type PermissionDecision = components["schemas"]["PermissionDecision"];
export type ResolvePermissionRequest =
  components["schemas"]["ResolvePermissionRequest"];

export interface ListSessionEventsOptions {
  afterSeq?: number;
}

export function normalizeSessionControls(
  controls: GeneratedNormalizedSessionControls,
): NormalizedSessionControls {
  return {
    ...controls,
    extras: controls.extras ?? [],
  };
}

export function normalizeSessionLiveConfigSnapshot(
  liveConfig: GeneratedSessionLiveConfigSnapshot,
): SessionLiveConfigSnapshot {
  return {
    ...liveConfig,
    normalizedControls: normalizeSessionControls(liveConfig.normalizedControls),
  };
}

export function normalizeSession(session: GeneratedSession): Session {
  if (!session.liveConfig) {
    return {
      ...session,
      liveConfig: session.liveConfig ?? null,
    };
  }

  return {
    ...session,
    liveConfig: normalizeSessionLiveConfigSnapshot(session.liveConfig),
  };
}
