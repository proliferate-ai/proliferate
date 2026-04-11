import type {
  CoworkArtifactSummary,
  TranscriptItem,
  TranscriptState,
  ToolCallItem,
  ToolResultTextContentPart,
  TurnRecord,
} from "@anyharness/sdk";

export interface CoworkArtifactProvisionalMetadata {
  title?: string;
  path?: string;
  description?: string;
}

export interface CoworkArtifactToolPresentation {
  action: "create" | "update";
  running: boolean;
  summary: CoworkArtifactSummary | null;
  provisional: CoworkArtifactProvisionalMetadata;
  failureMessage?: string;
}

export type CoworkArtifactToolCallItem = ToolCallItem & {
  semanticKind: "cowork_artifact_create" | "cowork_artifact_update";
};

export function isCoworkArtifactToolCall(
  item: TranscriptItem | null | undefined,
): item is CoworkArtifactToolCallItem {
  return item?.kind === "tool_call" && (
    item.semanticKind === "cowork_artifact_create"
    || item.semanticKind === "cowork_artifact_update"
  );
}

export function collectTurnCoworkArtifactToolCalls(
  turn: Pick<TurnRecord, "itemOrder">,
  transcript: Pick<TranscriptState, "itemsById">,
): CoworkArtifactToolCallItem[] {
  return turn.itemOrder
    .map((itemId) => transcript.itemsById[itemId] ?? null)
    .filter(isCoworkArtifactToolCall);
}

export function deriveCoworkArtifactToolPresentation(
  item: ToolCallItem,
): CoworkArtifactToolPresentation | null {
  const action = resolveArtifactAction(item.semanticKind);
  if (!action) {
    return null;
  }

  const provisional = deriveProvisionalMetadata(item);
  const summary = decodeArtifactSummary(item);

  return {
    action,
    running: item.status === "in_progress",
    summary,
    provisional,
    failureMessage: summary ? undefined : deriveFailureMessage(item),
  };
}

function resolveArtifactAction(
  semanticKind: ToolCallItem["semanticKind"],
): "create" | "update" | null {
  if (semanticKind === "cowork_artifact_create") {
    return "create";
  }
  if (semanticKind === "cowork_artifact_update") {
    return "update";
  }
  return null;
}

function deriveProvisionalMetadata(
  item: ToolCallItem,
): CoworkArtifactProvisionalMetadata {
  const rawInput = isRecord(item.rawInput) ? item.rawInput : null;
  return {
    title: readString(rawInput?.title) ?? undefined,
    path: readString(rawInput?.path) ?? undefined,
    description: readString(rawInput?.description) ?? undefined,
  };
}

function decodeArtifactSummary(item: ToolCallItem): CoworkArtifactSummary | null {
  const fromRawOutput = coerceArtifactSummary(item.rawOutput);
  if (fromRawOutput) {
    return fromRawOutput;
  }

  const toolResultParts = item.contentParts.filter(
    (part): part is ToolResultTextContentPart => part.type === "tool_result_text",
  );
  for (const part of toolResultParts) {
    const parsed = coerceArtifactSummary(part.text);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function deriveFailureMessage(item: ToolCallItem): string | undefined {
  if (item.status !== "failed") {
    return undefined;
  }

  const rawOutput = coerceDisplayText(item.rawOutput);
  if (rawOutput) {
    return rawOutput;
  }

  const toolResultText = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text.trim())
    .find((text) => text.length > 0);

  return toolResultText || undefined;
}

function coerceArtifactSummary(value: unknown): CoworkArtifactSummary | null {
  if (typeof value === "string") {
    try {
      return coerceArtifactSummary(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (!isRecord(value)) {
    return null;
  }

  if ("result" in value) {
    return coerceArtifactSummary(value.result);
  }

  if (
    !isString(value.id)
    || !isString(value.path)
    || !isString(value.type)
    || !isString(value.title)
    || !isString(value.createdAt)
    || !isString(value.updatedAt)
    || typeof value.exists !== "boolean"
  ) {
    return null;
  }

  if (value.description !== undefined && value.description !== null && !isString(value.description)) {
    return null;
  }
  if (value.sizeBytes !== undefined && value.sizeBytes !== null && typeof value.sizeBytes !== "number") {
    return null;
  }
  if (value.modifiedAt !== undefined && value.modifiedAt !== null && !isString(value.modifiedAt)) {
    return null;
  }

  return value as CoworkArtifactSummary;
}

function coerceDisplayText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
