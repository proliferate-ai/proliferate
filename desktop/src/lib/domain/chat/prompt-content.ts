import type { ContentPart, PromptCapabilities, ProposedPlanDetail } from "@anyharness/sdk";

export const PROMPT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROMPT_TEXT_RESOURCE_MAX_BYTES = 256 * 1024;

export interface PromptAttachmentDescriptor {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource";
  objectUrl: string | null;
}

export interface PromptPlanAttachmentDescriptor {
  id: string;
  kind: "plan_reference";
  planId: string;
  title: string;
  bodyMarkdown: string;
  snapshotHash: string;
  sourceSessionId: string;
  sourceTurnId?: string | null;
  sourceItemId?: string | null;
  sourceKind: string;
  sourceToolCallId?: string | null;
  resolutionState?: "ready" | "loading" | "error" | "stale";
  resolutionMessage?: string;
}

export interface PromptPlanAttachmentPointer {
  id: string;
  kind: "plan_reference";
  planId: string;
  snapshotHash: string;
}

export type PromptDraftAttachmentDescriptor =
  | PromptAttachmentDescriptor
  | PromptPlanAttachmentDescriptor;

export type PromptDisplayPart =
  | PromptDisplayTextPart
  | PromptDisplayImagePart
  | PromptDisplayFilePart
  | PromptDisplayLinkPart
  | PromptDisplayPlanPart;

export type PromptDisplayAttachmentPart =
  | PromptDisplayImagePart
  | PromptDisplayFilePart
  | PromptDisplayLinkPart
  | PromptDisplayPlanPart;

export interface PromptDisplayPartBase {
  id: string;
  name?: string;
  mimeType?: string;
  size?: number;
  sizeLabel?: string;
  preview?: string;
  attachmentId?: string;
  objectUrl?: string | null;
  uri?: string;
}

export interface PromptDisplayTextPart extends PromptDisplayPartBase {
  type: "text";
  text: string;
  isFallback: boolean;
}

export interface PromptDisplayImagePart extends PromptDisplayPartBase {
  type: "image";
  name: string;
}

export interface PromptDisplayFilePart extends PromptDisplayPartBase {
  type: "file";
  name: string;
}

export interface PromptDisplayLinkPart extends PromptDisplayPartBase {
  type: "link";
  name: string;
  uri: string;
}

export interface PromptDisplayPlanPart extends PromptDisplayPartBase {
  type: "plan_reference";
  planId: string;
  title: string;
  bodyMarkdown: string;
  snapshotHash: string;
  sourceSessionId: string;
  sourceTurnId?: string | null;
  sourceItemId?: string | null;
  sourceKind: string;
  sourceToolCallId?: string | null;
  resolutionState?: "ready" | "loading" | "error" | "stale";
  resolutionMessage?: string;
}

export function defaultPromptCapabilities(): PromptCapabilities {
  return {
    image: false,
    audio: false,
    embeddedContext: false,
  };
}

export function canAttachPromptContent(capabilities: PromptCapabilities | null | undefined): boolean {
  return !!capabilities?.image || !!capabilities?.embeddedContext;
}

export function isTextFileCandidate(file: File): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }
  return /\.(c|cc|cpp|cs|css|go|h|hpp|html|java|js|jsx|json|md|py|rs|sh|sql|swift|toml|ts|tsx|txt|xml|ya?ml)$/i
    .test(file.name);
}

export function normalizeContentParts(
  parts: readonly ContentPart[],
  fallbackText = "",
): PromptDisplayPart[] {
  if (parts.length === 0) {
    return fallbackText
      ? [{
        type: "text",
        id: "fallback-text",
        text: fallbackText,
        isFallback: true,
      }]
      : [];
  }

  return parts.flatMap((part, index): PromptDisplayPart[] => {
    switch (part.type) {
      case "text":
        return part.text
          ? [{
            type: "text",
            id: `text-${index}`,
            text: part.text,
            isFallback: false,
          }]
          : [];

      case "image": {
        const name = part.name ?? "attached image";
        return [{
          type: "image",
          id: part.attachmentId || `image-${index}`,
          attachmentId: part.attachmentId,
          name,
          mimeType: part.mimeType,
          size: part.size ?? undefined,
          sizeLabel: formatPromptFileSize(part.size),
          uri: part.uri ?? undefined,
        }];
      }

      case "resource": {
        const name = part.name ?? displayNameForUri(part.uri) ?? "attached file";
        return [{
          type: "file",
          id: part.attachmentId ?? part.uri ?? `file-${index}`,
          attachmentId: part.attachmentId ?? undefined,
          name,
          mimeType: part.mimeType ?? undefined,
          size: part.size ?? undefined,
          sizeLabel: formatPromptFileSize(part.size),
          preview: part.preview ?? undefined,
          uri: part.uri,
        }];
      }

      case "resource_link":
        return [{
          type: "link",
          id: part.uri || `link-${index}`,
          name: part.title ?? part.name,
          mimeType: part.mimeType ?? undefined,
          size: part.size ?? undefined,
          sizeLabel: formatPromptFileSize(part.size),
          preview: part.description ?? undefined,
          uri: part.uri,
        }];

      case "plan_reference":
        return [{
          type: "plan_reference",
          id: planAttachmentId(part.planId, part.snapshotHash),
          name: part.title || "Plan",
          planId: part.planId,
          title: part.title || "Plan",
          bodyMarkdown: part.bodyMarkdown,
          snapshotHash: part.snapshotHash,
          sourceSessionId: part.sourceSessionId,
          sourceTurnId: part.sourceTurnId ?? null,
          sourceItemId: part.sourceItemId ?? null,
          sourceKind: part.sourceKind,
          sourceToolCallId: part.sourceToolCallId ?? null,
        }];

      default:
        return [];
    }
  });
}

export function normalizeDraftAttachments(
  attachments: readonly PromptDraftAttachmentDescriptor[],
): PromptDisplayAttachmentPart[] {
  return attachments.map((attachment) => {
    if (attachment.kind === "plan_reference") {
      return {
        type: "plan_reference" as const,
        id: attachment.id,
        name: attachment.title,
        planId: attachment.planId,
        title: attachment.title,
        bodyMarkdown: attachment.bodyMarkdown,
        snapshotHash: attachment.snapshotHash,
        sourceSessionId: attachment.sourceSessionId,
        sourceTurnId: attachment.sourceTurnId ?? null,
        sourceItemId: attachment.sourceItemId ?? null,
        sourceKind: attachment.sourceKind,
        sourceToolCallId: attachment.sourceToolCallId ?? null,
        ...(attachment.resolutionState && attachment.resolutionState !== "ready"
          ? { resolutionState: attachment.resolutionState }
          : {}),
        ...(attachment.resolutionMessage
          ? { resolutionMessage: attachment.resolutionMessage }
          : {}),
      };
    }

    const base = {
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      sizeLabel: formatPromptFileSize(attachment.size),
      objectUrl: attachment.objectUrl,
    };

    if (attachment.kind === "image") {
      return {
        ...base,
        type: "image" as const,
      };
    }

    return {
      ...base,
      type: "file" as const,
    };
  });
}

export function formatPromptFileSize(size: number | null | undefined): string | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return undefined;
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = value >= 10 || Number.isInteger(value)
    ? Math.round(value).toString()
    : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export function promptPartSummary(part: PromptDisplayPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
      return `[image: ${part.name}]`;
    case "file":
      return `[file: ${part.name}]`;
    case "link":
      return `[link: ${part.name}]`;
    case "plan_reference":
      return `[plan: ${part.title}]`;
    default:
      return "";
  }
}

export function planAttachmentId(planId: string, snapshotHash: string): string {
  return `plan:${planId}:${snapshotHash}`;
}

export function planAttachmentPointerFromDescriptor(
  plan: PromptPlanAttachmentDescriptor,
): PromptPlanAttachmentPointer {
  return {
    id: plan.id,
    kind: "plan_reference",
    planId: plan.planId,
    snapshotHash: plan.snapshotHash,
  };
}

export function planAttachmentDescriptorFromDetail(
  plan: ProposedPlanDetail,
): PromptPlanAttachmentDescriptor {
  return {
    id: planAttachmentId(plan.id, plan.snapshotHash),
    kind: "plan_reference",
    planId: plan.id,
    title: plan.title,
    bodyMarkdown: plan.bodyMarkdown,
    snapshotHash: plan.snapshotHash,
    sourceSessionId: plan.sourceSessionId,
    sourceTurnId: plan.sourceTurnId ?? null,
    sourceItemId: plan.sourceItemId ?? null,
    sourceKind: plan.sourceKind,
    sourceToolCallId: plan.sourceToolCallId ?? null,
    resolutionState: "ready",
  };
}

export function planAttachmentPlaceholderFromPointer(
  pointer: PromptPlanAttachmentPointer,
  resolutionState: "loading" | "error" | "stale",
  resolutionMessage?: string,
): PromptPlanAttachmentDescriptor {
  return {
    id: pointer.id,
    kind: "plan_reference",
    planId: pointer.planId,
    title: placeholderTitleForPlanState(resolutionState),
    bodyMarkdown: resolutionMessage ?? placeholderMessageForPlanState(resolutionState),
    snapshotHash: pointer.snapshotHash,
    sourceSessionId: "",
    sourceTurnId: null,
    sourceItemId: null,
    sourceKind: "unknown",
    sourceToolCallId: null,
    resolutionState,
    resolutionMessage,
  };
}

export function isResolvedPlanAttachment(
  plan: PromptPlanAttachmentDescriptor,
): boolean {
  return (plan.resolutionState ?? "ready") === "ready";
}

export function planReferenceContentPartFromDescriptor(
  plan: PromptPlanAttachmentDescriptor,
): Extract<ContentPart, { type: "plan_reference" }> {
  return {
    type: "plan_reference",
    planId: plan.planId,
    title: plan.title,
    bodyMarkdown: plan.bodyMarkdown,
    snapshotHash: plan.snapshotHash,
    sourceSessionId: plan.sourceSessionId,
    sourceTurnId: plan.sourceTurnId ?? null,
    sourceItemId: plan.sourceItemId ?? null,
    sourceKind: plan.sourceKind,
    sourceToolCallId: plan.sourceToolCallId ?? null,
  };
}

export function summarizeContentParts(parts: readonly ContentPart[], fallbackText = ""): string {
  return normalizeContentParts(parts, fallbackText)
    .map(promptPartSummary)
    .filter(Boolean)
    .join("\n");
}

function displayNameForUri(uri: string | null | undefined): string | null {
  if (!uri) {
    return null;
  }

  const segments = uri.split(/[\\/]/u).filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) {
    return uri;
  }

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

function placeholderTitleForPlanState(
  resolutionState: "loading" | "error" | "stale",
): string {
  switch (resolutionState) {
    case "loading":
      return "Loading plan";
    case "error":
      return "Plan unavailable";
    case "stale":
      return "Plan snapshot changed";
  }
}

function placeholderMessageForPlanState(
  resolutionState: "loading" | "error" | "stale",
): string {
  switch (resolutionState) {
    case "loading":
      return "The attached plan is still loading.";
    case "error":
      return "The attached plan could not be loaded. Remove it and attach the plan again.";
    case "stale":
      return "This attached plan snapshot no longer matches the stored plan. Remove it and attach the latest plan.";
  }
}
