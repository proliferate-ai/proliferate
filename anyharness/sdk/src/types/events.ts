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
type PendingPromptAddedPayload =
  components["schemas"]["PendingPromptAddedPayload"];
type PendingPromptUpdatedPayload =
  components["schemas"]["PendingPromptUpdatedPayload"];
type PendingPromptRemovedPayload =
  components["schemas"]["PendingPromptRemovedPayload"];

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
export type PendingPromptAddedEvent = PendingPromptAddedPayload & {
  type: "pending_prompt_added";
};
export type PendingPromptUpdatedEvent = PendingPromptUpdatedPayload & {
  type: "pending_prompt_updated";
};
export type PendingPromptRemovedEvent = PendingPromptRemovedPayload & {
  type: "pending_prompt_removed";
};
export type PendingPromptRemovalReason =
  components["schemas"]["PendingPromptRemovalReason"];
export type PendingPromptSummary = components["schemas"]["PendingPromptSummary"];
export type InteractionKind = components["schemas"]["InteractionKind"];
export type InteractionSource = components["schemas"]["InteractionSource"];
export type InteractionPayload = components["schemas"]["InteractionPayload"];
export type InteractionOutcome = components["schemas"]["InteractionOutcome"];
export type PermissionInteractionPayload =
  components["schemas"]["PermissionInteractionPayload"];
export type PermissionInteractionContext =
  components["schemas"]["PermissionInteractionContext"];
export type PermissionInteractionOption =
  components["schemas"]["PermissionInteractionOption"];
export type PermissionInteractionOptionKind =
  components["schemas"]["PermissionInteractionOptionKind"];
export type UserInputInteractionPayload =
  components["schemas"]["UserInputInteractionPayload"];
export type UserInputQuestion = components["schemas"]["UserInputQuestion"];
export type UserInputQuestionOption =
  components["schemas"]["UserInputQuestionOption"];
export type UserInputSubmittedAnswer =
  components["schemas"]["UserInputSubmittedAnswer"];
export type McpElicitationInteractionPayload =
  components["schemas"]["McpElicitationInteractionPayload"];
export type McpElicitationMode = components["schemas"]["McpElicitationMode"];
export type McpElicitationFormPayload =
  components["schemas"]["McpElicitationFormPayload"];
export type McpElicitationUrlPayload =
  components["schemas"]["McpElicitationUrlPayload"];
export type McpElicitationField =
  components["schemas"]["McpElicitationField"];
export type McpElicitationFieldBase =
  components["schemas"]["McpElicitationFieldBase"];
export type McpElicitationTextField =
  components["schemas"]["McpElicitationTextField"];
export type McpElicitationTextFormat =
  components["schemas"]["McpElicitationTextFormat"];
export type McpElicitationNumberField =
  components["schemas"]["McpElicitationNumberField"];
export type McpElicitationBooleanField =
  components["schemas"]["McpElicitationBooleanField"];
export type McpElicitationSelectField =
  components["schemas"]["McpElicitationSelectField"];
export type McpElicitationMultiSelectField =
  components["schemas"]["McpElicitationMultiSelectField"];
export type McpElicitationOption =
  components["schemas"]["McpElicitationOption"];
export type McpElicitationSubmittedField =
  components["schemas"]["McpElicitationSubmittedField"];
export type McpElicitationSubmittedValue =
  components["schemas"]["McpElicitationSubmittedValue"];
export type InteractionRequestedEvent =
  components["schemas"]["InteractionRequestedEvent"] & {
    type: "interaction_requested";
  };
export type InteractionResolvedEvent =
  components["schemas"]["InteractionResolvedEvent"] & {
    type: "interaction_resolved";
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
  | PendingPromptAddedEvent
  | PendingPromptUpdatedEvent
  | PendingPromptRemovedEvent
  | InteractionRequestedEvent
  | InteractionResolvedEvent
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
export type ProposedPlanContentPart = Extract<ContentPart, { type: "proposed_plan" }>;
export type PlanReferenceContentPart = Extract<ContentPart, { type: "plan_reference" }>;
export type ProposedPlanDecisionContentPart = Extract<ContentPart, { type: "proposed_plan_decision" }>;
export type ToolInputTextContentPart = Extract<ContentPart, { type: "tool_input_text" }>;
export type ToolResultTextContentPart = Extract<ContentPart, { type: "tool_result_text" }>;

export type ReasoningVisibility = components["schemas"]["ReasoningVisibility"];
export type TerminalLifecycleEvent =
  components["schemas"]["TerminalLifecycleEvent"];
export type FileReadScope = components["schemas"]["FileReadScope"];
export type FileChangeOperation = components["schemas"]["FileChangeOperation"];
export type FileOpenTarget = components["schemas"]["FileOpenTarget"];

export type PlanEntry = components["schemas"]["PlanEntry"];
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
