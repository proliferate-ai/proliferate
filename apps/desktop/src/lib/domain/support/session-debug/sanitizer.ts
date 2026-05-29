import type {
  ContentPart,
  Session,
  SessionEventEnvelope,
} from "@anyharness/sdk";
import type { SessionDebugExportedSession } from "@/lib/domain/support/session-debug/export-models";

export function sanitizeSessionDebugExportedSession(
  session: SessionDebugExportedSession,
): SessionDebugExportedSession {
  return {
    ...session,
    session: session.session ? sanitizeSessionSummary(session.session) : null,
    normalizedEvents: session.normalizedEvents?.map(sanitizeSessionEventEnvelope) ?? null,
    rawNotifications: session.rawNotifications?.map((notification) => ({
      ...notification,
      notification: { redacted: true },
    })) ?? null,
  };
}

export function sanitizeSessionDebugContentParts(parts: ContentPart[]): ContentPart[] {
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

function sanitizeSessionSummary(session: Session): Session {
  return {
    ...session,
    pendingPrompts: (session.pendingPrompts ?? []).map((prompt) => ({
      ...prompt,
      text: `[content:${prompt.text.length}]`,
      contentParts: sanitizeSessionDebugContentParts(prompt.contentParts ?? []),
    })),
  };
}

function sanitizeSessionEventEnvelope(envelope: SessionEventEnvelope): SessionEventEnvelope {
  const event = envelope.event;
  if (event.type === "item_started" || event.type === "item_completed") {
    return {
      ...envelope,
      event: {
        ...event,
        item: {
          ...event.item,
          contentParts: sanitizeSessionDebugContentParts(event.item.contentParts ?? []),
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
            ? sanitizeSessionDebugContentParts(event.delta.replaceContentParts)
            : undefined,
          appendContentParts: event.delta.appendContentParts
            ? sanitizeSessionDebugContentParts(event.delta.appendContentParts)
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
        text: `[content:${event.text.length}]`,
        contentParts: sanitizeSessionDebugContentParts(event.contentParts ?? []),
      },
    };
  }
  return envelope;
}
