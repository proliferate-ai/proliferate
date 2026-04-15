import { useSearchParams } from "react-router-dom";
import { PlaygroundComposer } from "@/components/playground/PlaygroundComposer";
import { PlaygroundScenarioBar } from "@/components/playground/PlaygroundScenarioBar";
import { PlaygroundTranscript } from "@/components/playground/PlaygroundTranscript";
import {
  resolvePlaygroundScenarioSelection,
  type ScenarioKey,
} from "@/config/playground";
import { useReplaySession } from "@/hooks/playground/use-replay-session";

export function ChatPlaygroundPage() {
  const [params, setParams] = useSearchParams();
  const selection = resolvePlaygroundScenarioSelection(params.get("s"));
  const replay = useReplaySession(
    selection.kind === "recording" ? selection.recordingId : null,
  );

  const handleSelectFixture = (key: ScenarioKey) => {
    const next = new URLSearchParams(params);
    next.set("s", key);
    setParams(next, { replace: true });
  };

  const handleSelectRecording = (recordingId: string) => {
    const next = new URLSearchParams(params);
    next.set("s", recordingId);
    setParams(next, { replace: true });
  };

  return (
    <div className="chat-selection-root flex h-screen flex-col bg-background text-foreground">
      <PlaygroundScenarioBar
        selection={selection}
        replay={replay}
        onSelectFixture={handleSelectFixture}
        onSelectRecording={handleSelectRecording}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <PlaygroundTranscript selection={selection} replay={replay} />
          </div>
        </div>
        <PlaygroundComposer selection={selection} replay={replay} />
      </main>
      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <code className="font-mono">?s={selection.raw}</code>
        <span className="mx-2">·</span>
        Dev only · import.meta.env.DEV
      </footer>
    </div>
  );
}
