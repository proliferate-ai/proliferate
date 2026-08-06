import type { ContentPart, TranscriptState } from "@anyharness/sdk";

interface UserMessageEchoLike {
  kind?: string | null;
  contentParts?: readonly ContentPart[] | null;
  text?: string | null;
}

export function isRenderableUserMessageEcho(
  item: UserMessageEchoLike | null | undefined,
): boolean {
  if (!item || item.kind !== "user_message") {
    return false;
  }

  if (typeof item.text === "string" && item.text.trim().length > 0) {
    return true;
  }

  return item.contentParts?.some(isRenderableContentPart) ?? false;
}

export function transcriptHasRenderablePromptEcho(
  transcript: TranscriptState,
  promptId: string,
): boolean {
  return Object.values(transcript.itemsById).some((item) =>
    item.kind === "user_message"
    && item.promptId === promptId
    && isRenderableUserMessageEcho(item)
  );
}

function isRenderableContentPart(part: ContentPart): boolean {
  if (part.type === "text") {
    return part.text.trim().length > 0;
  }
  return true;
}
