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

export function readSessionDebugDiscriminant(value: object, key: string): string | null {
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
      return readSessionDebugDiscriminant(value, "status") === "exited"
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
      return CONTENT_PART_CONTRACTS[
        readSessionDebugDiscriminant(value, "type") ?? ""
      ] ?? EMPTY_CONTRACT;
    case "event":
      return EVENT_CONTRACTS[
        readSessionDebugDiscriminant(value, "type") ?? ""
      ] ?? EMPTY_CONTRACT;
    case "elicitationMode":
      return readSessionDebugDiscriminant(value, "mode") === "url"
        ? { booleans: new Set(["requiresReveal"]) }
        : EMPTY_CONTRACT;
    case "elicitationField":
      return elicitationFieldContract(value);
    case "errorDetails":
      return readSessionDebugDiscriminant(value, "kind") === "provider_rate_limit"
        ? { numbers: new Set(["limit"]) }
        : EMPTY_CONTRACT;
    default:
      return EMPTY_CONTRACT;
  }
}

function elicitationFieldContract(value: object): PrimitiveContract {
  switch (readSessionDebugDiscriminant(value, "fieldType")) {
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
