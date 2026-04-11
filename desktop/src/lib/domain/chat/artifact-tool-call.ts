import type { ToolCallItem, TranscriptItem } from "@anyharness/sdk";

export interface ArtifactToolCallData {
  action: string | null;
  artifactId: string | null;
  title: string;
  renderer: string | null;
  entry: string | null;
}

export function isArtifactToolCallItem(
  item: TranscriptItem | ToolCallItem | null | undefined,
): item is ToolCallItem {
  return !!item && item.kind === "tool_call" && getArtifactToolCallData(item) !== null;
}

export function getArtifactToolCallData(
  item: ToolCallItem,
): ArtifactToolCallData | null {
  const structured = readArtifactStructuredOutput(item.rawOutput);
  const matchesName =
    nameLooksLikeArtifactTool(item.nativeToolName)
    || nameLooksLikeArtifactTool(item.title);

  if (!matchesName && !structured) {
    return null;
  }

  return {
    action: structured?.action ?? null,
    artifactId: structured?.artifactId ?? null,
    title: structured?.title ?? item.title ?? item.nativeToolName ?? "Artifact",
    renderer: structured?.renderer ?? null,
    entry: structured?.entry ?? null,
  };
}

function nameLooksLikeArtifactTool(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.includes("create_artifact")
    || normalized.includes("update_artifact")
    || normalized.includes("proliferate.create_artifact")
    || normalized.includes("proliferate.update_artifact");
}

function readArtifactStructuredOutput(
  rawOutput: unknown,
): Omit<ArtifactToolCallData, "title"> & { title: string | null } | null {
  if (!rawOutput || typeof rawOutput !== "object") {
    return null;
  }

  const structuredContent = (rawOutput as {
    structuredContent?: {
      action?: unknown;
      artifact?: {
        id?: unknown;
        title?: unknown;
        renderer?: unknown;
        entry?: unknown;
      };
    };
  }).structuredContent;
  const artifact = structuredContent?.artifact;

  if (!structuredContent && !artifact) {
    return null;
  }

  return {
    action: typeof structuredContent?.action === "string" ? structuredContent.action : null,
    artifactId: typeof artifact?.id === "string" ? artifact.id : null,
    title: typeof artifact?.title === "string" ? artifact.title : null,
    renderer: typeof artifact?.renderer === "string" ? artifact.renderer : null,
    entry: typeof artifact?.entry === "string" ? artifact.entry : null,
  };
}
