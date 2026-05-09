import type { ContentPart } from "@anyharness/sdk";
import {
  formatPromptFileSize,
  type PromptAttachmentSource,
  type PromptDraftAttachmentDescriptor,
} from "@/lib/domain/chat/composer/prompt-attachment-rules";
import { planAttachmentId } from "@/lib/domain/chat/composer/prompt-plan-attachments";

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
  source?: PromptAttachmentSource;
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
          source: part.source ?? "upload",
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
          source: part.source ?? "upload",
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
      source: attachment.source,
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

export function promptPartSummary(part: PromptDisplayPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
      return `[image: ${part.name}]`;
    case "file":
      return part.source === "paste" ? `[paste: ${part.name}]` : `[file: ${part.name}]`;
    case "link":
      return `[link: ${part.name}]`;
    case "plan_reference":
      return `[plan: ${part.title}]`;
    default:
      return "";
  }
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
