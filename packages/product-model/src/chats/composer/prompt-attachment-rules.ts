import type { PromptCapabilities } from "@anyharness/sdk";
import type { PromptPlanAttachmentDescriptor } from "./prompt-plan-attachments";

export const PROMPT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROMPT_TEXT_RESOURCE_MAX_BYTES = 256 * 1024;
export const PROMPT_PASTE_ATTACHMENT_MIN_CHARS = 2_000;
export const PROMPT_PASTE_ATTACHMENT_MIN_LINES = 25;

export type PromptAttachmentSource = "upload" | "paste";

export interface PromptAttachmentDescriptor {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text_resource";
  source: PromptAttachmentSource;
  objectUrl: string | null;
}

export type PromptDraftAttachmentDescriptor =
  | PromptAttachmentDescriptor
  | PromptPlanAttachmentDescriptor;

export interface PromptAttachmentFileCandidate {
  type: string;
  name: string;
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

export function isTextFileCandidate(file: PromptAttachmentFileCandidate): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }
  return /\.(c|cc|cpp|cs|css|go|h|hpp|html|java|js|jsx|json|md|py|rs|sh|sql|swift|toml|ts|tsx|txt|xml|ya?ml)$/i
    .test(file.name);
}

export function shouldCreatePasteAttachment(text: string): boolean {
  return text.length >= PROMPT_PASTE_ATTACHMENT_MIN_CHARS
    || text.split(/\r\n|\r|\n/u).length >= PROMPT_PASTE_ATTACHMENT_MIN_LINES;
}

export function pasteAttachmentName(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("-");
  return `paste-${stamp}.txt`;
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
