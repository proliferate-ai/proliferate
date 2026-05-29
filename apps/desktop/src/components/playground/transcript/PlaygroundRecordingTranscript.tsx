import { MessageList } from "@/components/workspace/chat/transcript/MessageList";
import type { PlaygroundReplayState } from "@/hooks/playground/use-replay-session";
import { resolveSessionViewState } from "@proliferate/product-domain/sessions/activity";
import { combineSessionRecord } from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

interface PlaygroundRecordingTranscriptProps {
  replay: PlaygroundReplayState;
  selectedWorkspaceId: string | null;
  stickyBottomInsetPx: number;
}

export function PlaygroundRecordingTranscript({
  replay,
  selectedWorkspaceId,
  stickyBottomInsetPx,
}: PlaygroundRecordingTranscriptProps) {
  const replayDirectory = useSessionDirectoryStore((state) =>
    replay.sessionId ? state.entriesById[replay.sessionId] ?? null : null
  );
  const replayTranscript = useSessionTranscriptStore((state) =>
    replay.sessionId ? state.entriesById[replay.sessionId] ?? null : null
  );
  const replaySlot = combineSessionRecord(replayDirectory, replayTranscript);

  if (replay.error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {replay.error}
      </div>
    );
  }

  if (!replay.enabled) {
    return (
      <div className="text-sm text-muted-foreground">
        Replay is disabled for this runtime.
      </div>
    );
  }

  if (!replay.sessionId || !replaySlot) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading replay session...
      </div>
    );
  }

  return (
    <div className="h-[min(720px,calc(100vh-13rem))] min-h-[420px]">
      <MessageList
        activeSessionId={replay.sessionId}
        selectedWorkspaceId={selectedWorkspaceId ?? replay.workspaceId}
        optimisticPrompt={replaySlot.optimisticPrompt}
        transcript={replaySlot.transcript}
        sessionViewState={resolveSessionViewState(replaySlot)}
        bottomInsetPx={stickyBottomInsetPx}
      />
    </div>
  );
}
