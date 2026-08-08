import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { deriveSubagentMcpReceiptPresentation } from "./subagent-tool-presentation";

/**
 * Which quiet verb an INBOUND agent message gets (ADR §4 "Agent messages").
 *
 * The ADR names two: a message that answers something this session sent is a
 * "replied", anything else is a "messaged". The provenance itself cannot tell
 * them apart — `agentSession` carries a source and an optional link and nothing
 * about what it answers — so the answer comes from the transcript: under
 * reply-is-the-wake, an inbound message from an agent this session already
 * messaged IS the reply to that send.
 *
 * The walk stops at the message being labelled, so a send made LATER never
 * turns an earlier message into a reply.
 */
export type AgentInboundMessageVerb = "replied" | "messaged";

export function agentInboundMessageVerb(input: {
  transcript: TranscriptState;
  sourceSessionId: string;
  itemId: string;
}): AgentInboundMessageVerb {
  const { transcript, sourceSessionId, itemId } = input;
  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) {
      continue;
    }
    for (const candidateId of turn.itemOrder) {
      if (candidateId === itemId) {
        return "messaged";
      }
      const item = transcript.itemsById[candidateId];
      if (item?.kind !== "tool_call") {
        continue;
      }
      if (isOutboundSendTo(item, sourceSessionId)) {
        return "replied";
      }
    }
  }
  return "messaged";
}

/** A settled `send_agent_message` / `send_subagent_message` aimed at this agent. */
function isOutboundSendTo(item: ToolCallItem, sourceSessionId: string): boolean {
  const presentation = deriveSubagentMcpReceiptPresentation(item);
  if (!presentation) {
    return false;
  }
  if (presentation.action !== "send" && presentation.action !== "agent_send") {
    return false;
  }
  return presentation.childSessionId === sourceSessionId;
}
