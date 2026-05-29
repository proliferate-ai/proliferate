import type {
  PendingPromptEntry,
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionDirectoryEntry } from "@/lib/domain/sessions/directory/directory-entry";
export type { HotPaintGate } from "@/lib/domain/sessions/hot-paint-gate";

export type HarnessConnectionState = "connecting" | "healthy" | "failed";

export interface SessionTranscriptEntry {
  sessionId: string;
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
  optimisticPrompt: PendingPromptEntry | null;
}

export interface SessionRuntimeRecord extends SessionDirectoryEntry {
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
  optimisticPrompt: PendingPromptEntry | null;
}
