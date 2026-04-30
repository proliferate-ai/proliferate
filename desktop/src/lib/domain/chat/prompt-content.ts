import type { ContentPart, PromptCapabilities } from "@anyharness/sdk";

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

export type PromptDisplayPart =
  | PromptDisplayTextPart
  | PromptDisplayImagePart
  | PromptDisplayFilePart
  | PromptDisplayLinkPart;

export type PromptDisplayAttachmentPart =
  | PromptDisplayImagePart
  | PromptDisplayFilePart
  | PromptDisplayLinkPart;

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

      default:
        return [];
    }
  });
}

export function normalizeDraftAttachments(
  attachments: readonly PromptAttachmentDescriptor[],
): PromptDisplayAttachmentPart[] {
  return attachments.map((attachment) => {
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
