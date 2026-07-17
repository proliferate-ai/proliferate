export type SessionDebugPrimitiveKind = "boolean" | "number";

export type SessionDebugSchemaNode =
  | "unknown"
  | "exportedSession"
  | "session"
  | "eventEnvelopeList"
  | "eventEnvelope"
  | "rawNotificationList"
  | "rawNotification"
  | "contentPartList"
  | "contentPart"
  | "actionCapabilities"
  | "goal"
  | "activity"
  | "agentList"
  | "agent"
  | "usage"
  | "loopList"
  | "loop"
  | "processList"
  | "process"
  | "processStatus"
  | "executionSummary"
  | "pendingInteractionList"
  | "pendingInteraction"
  | "interactionPayload"
  | "elicitationMode"
  | "elicitationFieldList"
  | "elicitationField"
  | "interactionQuestionList"
  | "interactionQuestion"
  | "pendingPromptList"
  | "pendingPrompt"
  | "liveConfigResponse"
  | "liveConfig"
  | "normalizedControls"
  | "normalizedControlList"
  | "normalizedControl"
  | "promptCapabilities"
  | "event"
  | "item"
  | "delta"
  | "errorDetails";

interface PrimitiveContract {
  booleans?: ReadonlySet<string>;
  numbers?: ReadonlySet<string>;
}

const EMPTY_CONTRACT: PrimitiveContract = {};
const ACTION_CAPABILITIES: PrimitiveContract = {
  booleans: new Set([
    "fork",
    "loopsNative",
    "supportsGoals",
    "supportsLoops",
    "targetedFork",
  ]),
};
const GOAL: PrimitiveContract = {
  booleans: new Set(["native"]),
  numbers: new Set([
    "iterations",
    "revision",
    "timeUsedSeconds",
    "tokenBudget",
    "tokensUsed",
  ]),
};
const AGENT: PrimitiveContract = { booleans: new Set(["background"]) };
const USAGE: PrimitiveContract = {
  numbers: new Set(["durationSeconds", "tokensUsed", "toolCalls"]),
};
const LOOP: PrimitiveContract = {
  booleans: new Set(["native", "recurring"]),
  numbers: new Set(["fireCount", "lastFiredAtMs", "updatedAtMs"]),
};
const PROCESS: PrimitiveContract = { numbers: new Set(["pid"]) };
const EXECUTION_SUMMARY: PrimitiveContract = {
  booleans: new Set(["hasLiveHandle"]),
};
const PROMPT_CAPABILITIES: PrimitiveContract = {
  booleans: new Set(["audio", "embeddedContext", "image"]),
};
const NORMALIZED_CONTROL: PrimitiveContract = {
  booleans: new Set(["settable"]),
};
const LIVE_CONFIG: PrimitiveContract = { numbers: new Set(["sourceSeq"]) };
const ENVELOPE: PrimitiveContract = { numbers: new Set(["seq"]) };
const PENDING_PROMPT: PrimitiveContract = { numbers: new Set(["seq"]) };
const ITEM: PrimitiveContract = { booleans: new Set(["isTransient"]) };
const DELTA: PrimitiveContract = { booleans: new Set(["isTransient"]) };
const INTERACTION_QUESTION: PrimitiveContract = {
  booleans: new Set(["isOther", "isSecret"]),
};

const CONTENT_PART_CONTRACTS: Readonly<Record<string, PrimitiveContract>> = {
  image: { numbers: new Set(["size"]) },
  resource: {
    booleans: new Set(["previewTruncated"]),
    numbers: new Set(["previewOriginalBytes", "size"]),
  },
  resource_link: { numbers: new Set(["size"]) },
  terminal_output: {
    booleans: new Set(["dataTruncated"]),
    numbers: new Set(["dataOriginalBytes", "exitCode"]),
  },
  file_read: {
    booleans: new Set(["previewTruncated"]),
    numbers: new Set(["endLine", "line", "previewOriginalBytes", "startLine"]),
  },
  file_change: {
    booleans: new Set(["patchTruncated", "previewTruncated"]),
    numbers: new Set([
      "additions",
      "deletions",
      "patchOriginalBytes",
      "previewOriginalBytes",
    ]),
  },
  proposed_plan_decision: { numbers: new Set(["decisionVersion"]) },
  tool_input_text: {
    booleans: new Set(["textTruncated"]),
    numbers: new Set(["textOriginalBytes"]),
  },
  tool_result_text: {
    booleans: new Set(["textTruncated"]),
    numbers: new Set(["textOriginalBytes"]),
  },
};

const EVENT_CONTRACTS: Readonly<Record<string, PrimitiveContract>> = {
  subagent_turn_completed: { numbers: new Set(["childLastEventSeq"]) },
  session_link_turn_completed: { numbers: new Set(["childLastEventSeq"]) },
  review_run_updated: {
    booleans: new Set(["autoIterate"]),
    numbers: new Set(["currentRoundNumber", "maxRounds"]),
  },
  usage_update: { numbers: new Set(["size", "used"]) },
  loop_fired: { numbers: new Set(["firedAtMs"]) },
  pending_prompt_added: { numbers: new Set(["seq"]) },
  pending_prompt_updated: { numbers: new Set(["seq"]) },
  pending_prompt_removed: { numbers: new Set(["seq"]) },
};

export function sessionDebugPrimitiveKind(
  node: SessionDebugSchemaNode,
  key: string,
  value: object,
): SessionDebugPrimitiveKind | undefined {
  const contract = primitiveContract(node, value);
  if (contract.numbers?.has(key)) {
    return "number";
  }
  if (contract.booleans?.has(key)) {
    return "boolean";
  }
  return undefined;
}

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
      return ownString(value, "mode") === "form" && key === "fields"
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

function primitiveContract(
  node: SessionDebugSchemaNode,
  value: object,
): PrimitiveContract {
  switch (node) {
    case "actionCapabilities":
      return ACTION_CAPABILITIES;
    case "goal":
      return GOAL;
    case "agent":
      return AGENT;
    case "usage":
      return USAGE;
    case "loop":
      return LOOP;
    case "process":
      return PROCESS;
    case "processStatus":
      return ownString(value, "status") === "exited"
        ? { numbers: new Set(["exitCode"]) }
        : EMPTY_CONTRACT;
    case "executionSummary":
      return EXECUTION_SUMMARY;
    case "promptCapabilities":
      return PROMPT_CAPABILITIES;
    case "normalizedControl":
      return NORMALIZED_CONTROL;
    case "liveConfig":
      return LIVE_CONFIG;
    case "eventEnvelope":
    case "rawNotification":
      return ENVELOPE;
    case "pendingPrompt":
      return PENDING_PROMPT;
    case "item":
      return ITEM;
    case "delta":
      return DELTA;
    case "interactionQuestion":
      return INTERACTION_QUESTION;
    case "contentPart":
      return CONTENT_PART_CONTRACTS[ownString(value, "type") ?? ""] ?? EMPTY_CONTRACT;
    case "event":
      return EVENT_CONTRACTS[ownString(value, "type") ?? ""] ?? EMPTY_CONTRACT;
    case "elicitationMode":
      return ownString(value, "mode") === "url"
        ? { booleans: new Set(["requiresReveal"]) }
        : EMPTY_CONTRACT;
    case "elicitationField":
      return elicitationFieldContract(value);
    case "errorDetails":
      return ownString(value, "kind") === "provider_rate_limit"
        ? { numbers: new Set(["limit"]) }
        : EMPTY_CONTRACT;
    default:
      return EMPTY_CONTRACT;
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
  const type = ownString(value, "type");
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
  const type = ownString(value, "type");
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

function elicitationFieldContract(value: object): PrimitiveContract {
  switch (ownString(value, "fieldType")) {
    case "text":
      return {
        booleans: new Set(["required"]),
        numbers: new Set(["maxLength", "minLength"]),
      };
    case "number":
      return { booleans: new Set(["integer", "required"]) };
    case "boolean":
    case "single_select":
      return { booleans: new Set(["required"]) };
    case "multi_select":
      return {
        booleans: new Set(["required"]),
        numbers: new Set(["maxItems", "minItems"]),
      };
    default:
      return EMPTY_CONTRACT;
  }
}

function ownString(value: object, key: string): string | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor
      && descriptor.enumerable === true
      && "value" in descriptor
      && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}
