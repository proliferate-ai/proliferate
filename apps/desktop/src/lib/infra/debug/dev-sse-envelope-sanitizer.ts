import type { ContentPart, SessionEventEnvelope } from "@anyharness/sdk";

export function sanitizeDevSSEEnvelope(envelope: SessionEventEnvelope): SessionEventEnvelope {
  const event = envelope.event;
  if (event.type === "item_started" || event.type === "item_completed") {
    return {
      ...envelope,
      event: {
        ...event,
        item: {
          ...event.item,
          contentParts: sanitizeContentParts(event.item.contentParts ?? []),
          rawInput: undefined,
          rawOutput: undefined,
        },
      },
    };
  }
  if (event.type === "item_delta") {
    return {
      ...envelope,
      event: {
        ...event,
        delta: {
          ...event.delta,
          replaceContentParts: event.delta.replaceContentParts
            ? sanitizeContentParts(event.delta.replaceContentParts)
            : undefined,
          appendContentParts: event.delta.appendContentParts
            ? sanitizeContentParts(event.delta.appendContentParts)
            : undefined,
          rawInput: undefined,
          rawOutput: undefined,
        },
      },
    };
  }
  if (event.type === "pending_prompt_added" || event.type === "pending_prompt_updated") {
    return {
      ...envelope,
      event: {
        ...event,
        text: summarizeSanitizedContent(event.contentParts ?? [], event.text),
        contentParts: sanitizeContentParts(event.contentParts ?? []),
      },
    };
  }
  if (event.type === "pending_prompts_reordered") {
    return {
      ...envelope,
      event: {
        ...event,
        pendingPrompts: event.pendingPrompts.map((prompt) => ({
          ...prompt,
          text: summarizeSanitizedContent(prompt.contentParts ?? [], prompt.text),
          contentParts: sanitizeContentParts(prompt.contentParts ?? []),
        })),
      },
    };
  }
  return envelope;
}

function sanitizeContentParts(parts: ContentPart[]): ContentPart[] {
  return parts.map((part) => {
    switch (part.type) {
      case "text":
        return { type: "text", text: `[text:${part.text.length}]` };
      case "resource":
        return { ...part, preview: part.preview ? `[preview:${part.preview.length}]` : undefined };
      case "tool_input_text":
        return { type: "tool_input_text", text: `[text:${part.text.length}]` };
      case "tool_result_text":
        return { type: "tool_result_text", text: `[text:${part.text.length}]` };
      default:
        return part;
    }
  });
}

function summarizeSanitizedContent(parts: ContentPart[], fallback: string): string {
  return parts.length > 0 ? `[content_parts:${parts.length}]` : `[text:${fallback.length}]`;
}
