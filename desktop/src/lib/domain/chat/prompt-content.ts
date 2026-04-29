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

export function summarizeContentParts(parts: readonly ContentPart[], fallbackText = ""): string {
  if (parts.length === 0) {
    return fallbackText;
  }

  return parts
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "image":
          return part.name ? `[image: ${part.name}]` : "[image]";
        case "resource":
          return part.name ? `[file: ${part.name}]` : `[file: ${part.uri}]`;
        case "resource_link":
          return `[link: ${part.name}]`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}
