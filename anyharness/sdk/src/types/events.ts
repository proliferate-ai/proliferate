import type { components } from "../generated/openapi.js";
import {
  normalizeSessionLiveConfigSnapshot,
  type SessionLiveConfigSnapshot,
} from "./sessions.js";

type SessionStartedPayload = components["schemas"]["SessionStartedEvent"];
type SessionEndedPayload = components["schemas"]["SessionEndedEvent"];
type TurnEndedPayload = components["schemas"]["TurnEndedEvent"];
type ItemStartedPayload = components["schemas"]["ItemStartedEvent"];
type ItemDeltaPayload = components["schemas"]["ItemDeltaEvent"];
type ItemCompletedPayload = components["schemas"]["ItemCompletedEvent"];
type AvailableCommandsUpdatePayload =
  components["schemas"]["AvailableCommandsUpdatePayload"];
type CurrentModeUpdatePayload =
  components["schemas"]["CurrentModeUpdatePayload"];
type ConfigOptionUpdatePayload =
  components["schemas"]["ConfigOptionUpdatePayload"];
type SessionStateUpdatePayload =
  components["schemas"]["SessionStateUpdatePayload"];
type SessionInfoUpdatePayload = components["schemas"]["SessionInfoUpdatePayload"];
type UsageUpdatePayload = components["schemas"]["UsageUpdatePayload"];

export type SessionEventEnvelope = Omit<
  components["schemas"]["SessionEventEnvelope"],
  "event"
> & {
  event: SessionEvent;
};
export type SessionRawNotificationEnvelope =
  components["schemas"]["SessionRawNotificationEnvelope"];

export type SessionStartedEvent = SessionStartedPayload & {
  type: "session_started";
};
export type SessionEndedEvent = SessionEndedPayload & {
  type: "session_ended";
};
export type TurnStartedEvent = { type: "turn_started" };
export type TurnEndedEvent = TurnEndedPayload & {
  type: "turn_ended";
};
export type ItemStartedEvent = ItemStartedPayload & {
  type: "item_started";
};
export type ItemDeltaEvent = ItemDeltaPayload & {
  type: "item_delta";
};
export type ItemCompletedEvent = ItemCompletedPayload & {
  type: "item_completed";
};
export type AvailableCommandsUpdateEvent = AvailableCommandsUpdatePayload & {
  type: "available_commands_update";
};
export type CurrentModeUpdateEvent = CurrentModeUpdatePayload & {
  type: "current_mode_update";
};
export type ConfigOptionUpdateEvent = Omit<ConfigOptionUpdatePayload, "liveConfig"> & {
  liveConfig: SessionLiveConfigSnapshot;
  type: "config_option_update";
};
export type SessionStateUpdateEvent = SessionStateUpdatePayload & {
  type: "session_state_update";
};
export type SessionInfoUpdateEvent = SessionInfoUpdatePayload & {
  type: "session_info_update";
};
export type UsageUpdateEvent = UsageUpdatePayload & {
  type: "usage_update";
};
export type PermissionRequestedEvent =
  components["schemas"]["PermissionRequestedEvent"] & {
    type: "permission_requested";
  };
export type PermissionResolvedEvent =
  components["schemas"]["PermissionResolvedEvent"] & {
    type: "permission_resolved";
  };
export type ErrorEvent = components["schemas"]["ErrorEvent"] & {
  type: "error";
};

export type SessionEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | ItemStartedEvent
  | ItemDeltaEvent
  | ItemCompletedEvent
  | AvailableCommandsUpdateEvent
  | CurrentModeUpdateEvent
  | ConfigOptionUpdateEvent
  | SessionStateUpdateEvent
  | SessionInfoUpdateEvent
  | UsageUpdateEvent
  | PermissionRequestedEvent
  | PermissionResolvedEvent
  | ErrorEvent;

export type SessionEndReason = components["schemas"]["SessionEndReason"];
export type StopReason = components["schemas"]["StopReason"];

export type TranscriptItemPayload = components["schemas"]["TranscriptItemPayload"];
export type TranscriptItemKind = components["schemas"]["TranscriptItemKind"];
export type TranscriptItemStatus = components["schemas"]["TranscriptItemStatus"];
export type TranscriptItemDeltaPayload =
  components["schemas"]["TranscriptItemDeltaPayload"];

export type ContentPart = components["schemas"]["ContentPart"];
export type TextContentPart = Extract<ContentPart, { type: "text" }>;
export type ReasoningContentPart = Extract<ContentPart, { type: "reasoning" }>;
export type ToolCallContentPart = Extract<ContentPart, { type: "tool_call" }>;
export type TerminalOutputContentPart = Extract<ContentPart, { type: "terminal_output" }>;
export type FileReadContentPart = Extract<ContentPart, { type: "file_read" }>;
export type FileChangeContentPart = Extract<ContentPart, { type: "file_change" }>;
export type PlanContentPart = Extract<ContentPart, { type: "plan" }>;
export type ToolInputTextContentPart = Extract<ContentPart, { type: "tool_input_text" }>;
export type ToolResultTextContentPart = Extract<ContentPart, { type: "tool_result_text" }>;

export type ReasoningVisibility = components["schemas"]["ReasoningVisibility"];
export type TerminalLifecycleEvent =
  components["schemas"]["TerminalLifecycleEvent"];
export type FileReadScope = components["schemas"]["FileReadScope"];
export type FileChangeOperation = components["schemas"]["FileChangeOperation"];
export type FileOpenTarget = components["schemas"]["FileOpenTarget"];

export type PlanEntry = components["schemas"]["PlanEntry"];
export type PermissionOutcome = components["schemas"]["PermissionOutcome"];

export function normalizeSessionEventEnvelope(
  envelope: SessionEventEnvelope,
): SessionEventEnvelope {
  if (envelope.event.type !== "config_option_update") {
    return envelope;
  }

  return {
    ...envelope,
    event: {
      ...envelope.event,
      liveConfig: normalizeSessionLiveConfigSnapshot(envelope.event.liveConfig),
    },
  };
}
