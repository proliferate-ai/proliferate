import type { TranscriptState } from "@anyharness/sdk";

export type CloudChatTranscriptRowKind =
  | "assistant"
  | "error"
  | "system"
  | "thought"
  | "tool"
  | "tool_group"
  | "proposed_plan"
  | "user";

export interface CloudChatTranscriptRowView {
  id: string;
  kind: CloudChatTranscriptRowKind;
  title?: string | null;
  body?: string | null;
  detail?: string | null;
  status?: string | null;
  streaming?: boolean;
  children?: CloudChatTranscriptRowView[];
  firstSeq?: number | null;
  lastSeq?: number | null;
  sourceRequestId?: string | null;
  sourceCommandId?: string | null;
  sourceToolCallId?: string | null;
  planId?: string | null;
  planTitle?: string | null;
  planBodyMarkdown?: string | null;
  planDecisionState?: "pending" | "approved" | "rejected" | "superseded" | null;
  planNativeResolutionState?: "none" | "pending_link" | "pending_resolution" | "finalized" | "failed" | null;
  planDecisionVersion?: number | null;
  planErrorMessage?: string | null;
  planNativeContinuation?: boolean;
}

export interface CloudTranscriptViewResult {
  rows: CloudChatTranscriptRowView[];
  source: "empty" | "events" | "projection";
  envelopeCount: number;
  missingEnvelopeCount: number;
}

export type CloudTranscriptStateSource = "empty" | "events" | "projection";

export type CloudTranscriptStateFallbackReason =
  | "empty"
  | "missing_envelopes"
  | "no_renderable_event_rows"
  | "projection_ahead_of_events";

export interface CloudTranscriptStateResult {
  transcript: TranscriptState | null;
  source: CloudTranscriptStateSource;
  envelopeCount: number;
  missingEnvelopeCount: number;
  latestEnvelopeSeq: number;
  latestProjectedSeq: number;
  fallbackReason: CloudTranscriptStateFallbackReason | null;
}

export interface CloudOptimisticPromptReference {
  text: string;
  baseTranscriptSeq: number;
}
