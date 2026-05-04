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
type GeneratedForkSessionResponse =
  components["schemas"]["ForkSessionResponse"];

export type SessionStatus = components["schemas"]["SessionStatus"];
export type SessionExecutionPhase = components["schemas"]["SessionExecutionPhase"];
export type PendingInteractionSummary =
  components["schemas"]["PendingInteractionSummary"];
export type PendingInteractionSource =
  components["schemas"]["PendingInteractionSource"];
export type PendingInteractionPayloadSummary =
  components["schemas"]["PendingInteractionPayloadSummary"];
export type SessionExecutionSummary = components["schemas"]["SessionExecutionSummary"];
export type SessionActionCapabilities =
  components["schemas"]["SessionActionCapabilities"];
export type Session = Omit<GeneratedSession, "liveConfig"> & {
  liveConfig?: SessionLiveConfigSnapshot | null;
  actionCapabilities: SessionActionCapabilities;
};
export type CreateSessionRequest = components["schemas"]["CreateSessionRequest"];
export type SessionMcpEnvVar = components["schemas"]["SessionMcpEnvVar"];
export type SessionMcpHeader = components["schemas"]["SessionMcpHeader"];
export type SessionMcpHttpServer = components["schemas"]["SessionMcpHttpServer"];
export type SessionMcpStdioServer = components["schemas"]["SessionMcpStdioServer"];
export type SessionMcpServer = components["schemas"]["SessionMcpServer"];
export type SessionMcpTransport = components["schemas"]["SessionMcpTransport"];
export type SessionMcpBindingOutcome =
  components["schemas"]["SessionMcpBindingOutcome"];
export type SessionMcpBindingNotAppliedReason =
  components["schemas"]["SessionMcpBindingNotAppliedReason"];
export type SessionMcpBindingSummary =
  components["schemas"]["SessionMcpBindingSummary"];
export type ResumeSessionRequest = components["schemas"]["ResumeSessionRequest"];
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
export type PromptCapabilities = components["schemas"]["PromptCapabilities"];
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
export type ForkSessionRequest = components["schemas"]["ForkSessionRequest"];
export type ForkSessionTarget = components["schemas"]["ForkSessionTarget"];
export type ForkSessionTargetType =
  components["schemas"]["ForkSessionTargetType"];
export type ForkChildStartStatus =
  components["schemas"]["ForkChildStartStatus"];
export type ForkChildStartSummary =
  components["schemas"]["ForkChildStartSummary"];
export type SessionLinkSummary = components["schemas"]["SessionLinkSummary"];
export type ForkSessionResponse = Omit<
  GeneratedForkSessionResponse,
  "session"
> & {
  session: Session;
};
export type PendingPromptSummary = components["schemas"]["PendingPromptSummary"];
export type EditPendingPromptRequest =
  components["schemas"]["EditPendingPromptRequest"];
export type SessionSubagentsResponse =
  components["schemas"]["SessionSubagentsResponse"];
export type ScheduleSubagentWakeRequest =
  components["schemas"]["ScheduleSubagentWakeRequest"];
export type ScheduleSubagentWakeResponse =
  components["schemas"]["ScheduleSubagentWakeResponse"];
export type ParentSubagentLinkSummary =
  components["schemas"]["ParentSubagentLinkSummary"];
export type ChildSubagentSummary =
  components["schemas"]["ChildSubagentSummary"];
export type SubagentCompletionSummary =
  components["schemas"]["SubagentCompletionSummary"];
export type InteractionDecision = components["schemas"]["InteractionDecision"];
export type ResolveInteractionRequest =
  components["schemas"]["ResolveInteractionRequest"];
export type McpElicitationUrlRevealResponse =
  components["schemas"]["McpElicitationUrlRevealResponse"];

export interface ListSessionEventsOptions {
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  turnLimit?: number;
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
    promptCapabilities: liveConfig.promptCapabilities ?? {
      image: false,
      audio: false,
      embeddedContext: false,
    },
  };
}

export function normalizeSession(session: GeneratedSession): Session {
  const actionCapabilities = session.actionCapabilities ?? {
    fork: false,
    targetedFork: false,
  };
  if (!session.liveConfig) {
    return {
      ...session,
      actionCapabilities,
      liveConfig: session.liveConfig ?? null,
    };
  }

  return {
    ...session,
    actionCapabilities,
    liveConfig: normalizeSessionLiveConfigSnapshot(session.liveConfig),
  };
}

export function normalizeForkSessionResponse(
  response: GeneratedForkSessionResponse,
): ForkSessionResponse {
  return {
    ...response,
    session: normalizeSession(response.session),
  };
}
