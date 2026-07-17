import {
  readSessionDebugDiscriminant,
  type SessionDebugSchemaNode,
} from "#product/lib/domain/support/session-debug/primitive-policy";

export function sessionDebugArrayElementNode(
  node: SessionDebugSchemaNode,
): SessionDebugSchemaNode {
  switch (node) {
    case "eventEnvelopeList":
      return "eventEnvelope";
    case "rawNotificationList":
      return "rawNotification";
    case "contentPartList":
      return "contentPart";
    case "agentList":
      return "agent";
    case "loopList":
      return "loop";
    case "processList":
      return "process";
    case "pendingInteractionList":
      return "pendingInteraction";
    case "elicitationFieldList":
      return "elicitationField";
    case "interactionQuestionList":
      return "interactionQuestion";
    case "pendingPromptList":
      return "pendingPrompt";
    case "normalizedControlList":
      return "normalizedControl";
    default:
      return "unknown";
  }
}

export function sessionDebugChildNode(
  node: SessionDebugSchemaNode,
  key: string,
  value: object,
): SessionDebugSchemaNode {
  switch (node) {
    case "exportedSession":
      return exportedSessionChild(key);
    case "session":
      return sessionChild(key);
    case "eventEnvelope":
      return key === "event" ? "event" : "unknown";
    case "activity":
      return activityChild(key);
    case "agent":
      return key === "usage" ? "usage" : "unknown";
    case "process":
      return key === "status" ? "processStatus" : "unknown";
    case "executionSummary":
      return key === "pendingInteractions" ? "pendingInteractionList" : "unknown";
    case "pendingInteraction":
      return key === "payload" ? "interactionPayload" : "unknown";
    case "interactionPayload":
      return interactionPayloadChild(key, value);
    case "elicitationMode":
      return readSessionDebugDiscriminant(value, "mode") === "form" && key === "fields"
        ? "elicitationFieldList"
        : "unknown";
    case "pendingPrompt":
      return key === "contentParts" ? "contentPartList" : "unknown";
    case "liveConfigResponse":
      return key === "liveConfig" ? "liveConfig" : "unknown";
    case "liveConfig":
      return liveConfigChild(key);
    case "normalizedControls":
      return normalizedControlsChild(key);
    case "event":
      return eventChild(key, value);
    case "item":
      return key === "contentParts" ? "contentPartList" : "unknown";
    case "delta":
      return key === "appendContentParts" || key === "replaceContentParts"
        ? "contentPartList"
        : "unknown";
    default:
      return "unknown";
  }
}

function exportedSessionChild(key: string): SessionDebugSchemaNode {
  switch (key) {
    case "session":
      return "session";
    case "normalizedEvents":
      return "eventEnvelopeList";
    case "rawNotifications":
      return "rawNotificationList";
    case "liveConfig":
      return "liveConfigResponse";
    default:
      return "unknown";
  }
}

function sessionChild(key: string): SessionDebugSchemaNode {
  switch (key) {
    case "actionCapabilities":
      return "actionCapabilities";
    case "activeGoal":
      return "goal";
    case "activity":
      return "activity";
    case "executionSummary":
      return "executionSummary";
    case "liveConfig":
      return "liveConfig";
    case "pendingPrompts":
      return "pendingPromptList";
    default:
      return "unknown";
  }
}

function activityChild(key: string): SessionDebugSchemaNode {
  switch (key) {
    case "agents":
      return "agentList";
    case "goal":
      return "goal";
    case "loops":
      return "loopList";
    case "processes":
      return "processList";
    default:
      return "unknown";
  }
}

function interactionPayloadChild(key: string, value: object): SessionDebugSchemaNode {
  const type = readSessionDebugDiscriminant(value, "type");
  if (type === "user_input" && key === "questions") {
    return "interactionQuestionList";
  }
  if (type === "mcp_elicitation" && key === "mode") {
    return "elicitationMode";
  }
  return "unknown";
}

function liveConfigChild(key: string): SessionDebugSchemaNode {
  if (key === "normalizedControls") {
    return "normalizedControls";
  }
  if (key === "promptCapabilities") {
    return "promptCapabilities";
  }
  return "unknown";
}

function normalizedControlsChild(key: string): SessionDebugSchemaNode {
  if (key === "extras") {
    return "normalizedControlList";
  }
  return ["collaborationMode", "effort", "fastMode", "mode", "model", "reasoning"]
      .includes(key)
    ? "normalizedControl"
    : "unknown";
}

function eventChild(key: string, value: object): SessionDebugSchemaNode {
  const type = readSessionDebugDiscriminant(value, "type");
  if ((type === "item_started" || type === "item_completed") && key === "item") {
    return "item";
  }
  if (type === "item_delta" && key === "delta") {
    return "delta";
  }
  if (type === "config_option_update" && key === "liveConfig") {
    return "liveConfig";
  }
  if (["goal_updated", "goal_met", "goal_cleared"].includes(type ?? "") && key === "goal") {
    return "goal";
  }
  if (["loop_upserted", "loop_fired"].includes(type ?? "") && key === "loop") {
    return "loop";
  }
  if (type === "process_upserted" && key === "process") {
    return "process";
  }
  if (type === "subagent_upserted" && key === "agent") {
    return "agent";
  }
  if (
    (type === "pending_prompt_added" || type === "pending_prompt_updated")
    && key === "contentParts"
  ) {
    return "contentPartList";
  }
  if (type === "pending_prompts_reordered" && key === "pendingPrompts") {
    return "pendingPromptList";
  }
  if (type === "interaction_requested" && key === "payload") {
    return "interactionPayload";
  }
  if (type === "error" && key === "details") {
    return "errorDetails";
  }
  return "unknown";
}
