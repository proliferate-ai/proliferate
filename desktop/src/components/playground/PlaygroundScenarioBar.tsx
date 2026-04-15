import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import {
  SCENARIOS,
  type PlaygroundScenarioSelection,
  type ScenarioKey,
} from "@/config/playground";
import type { PlaygroundReplayState } from "@/hooks/playground/use-replay-session";

interface PlaygroundScenarioBarProps {
  selection: PlaygroundScenarioSelection;
  replay: PlaygroundReplayState;
  onSelectFixture: (key: ScenarioKey) => void;
  onSelectRecording: (recordingId: string) => void;
}

export function PlaygroundScenarioBar({
  selection,
  replay,
  onSelectFixture,
  onSelectRecording,
}: PlaygroundScenarioBarProps) {
  const showRecordings = replay.enabled && replay.recordings.length > 0;

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="mr-3 text-sm font-semibold">Chat UI playground</div>
      <Link
        to="/"
        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to app
      </Link>
      <div className="mx-3 h-5 w-px bg-border" />
      {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
        const active = selection.kind === "fixture" && selection.key === key;
        return (
          <Button
            key={key}
            type="button"
            variant={active ? "inverted" : "secondary"}
            size="sm"
            onClick={() => onSelectFixture(key)}
            className="text-xs font-medium"
          >
            {SCENARIOS[key].label}
          </Button>
        );
      })}
      {showRecordings && (
        <>
          <div className="mx-3 h-5 w-px bg-border" />
          <div className="text-xs font-medium text-muted-foreground">Recordings</div>
          {replay.recordings.map((recording) => {
            const active = selection.kind === "recording"
              && selection.recordingId === recording.id;
            return (
              <Button
                key={recording.id}
                type="button"
                variant={active ? "inverted" : "secondary"}
                size="sm"
                onClick={() => onSelectRecording(recording.id)}
                className="text-xs font-medium"
              >
                {recording.label}
              </Button>
            );
          })}
        </>
      )}
      {replay.enabled && replay.isLoadingRecordings && (
        <span className="text-xs text-muted-foreground">Loading recordings...</span>
      )}
    </header>
  );
}
