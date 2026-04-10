import { useSearchParams } from "react-router-dom";
import { PlaygroundComposer } from "@/components/playground/PlaygroundComposer";
import { PlaygroundScenarioBar } from "@/components/playground/PlaygroundScenarioBar";
import { PlaygroundTranscript } from "@/components/playground/PlaygroundTranscript";
import { resolveScenarioKey, type ScenarioKey } from "@/config/playground";

export function ChatPlaygroundPage() {
  const [params, setParams] = useSearchParams();
  const scenario = resolveScenarioKey(params.get("s"));

  const handleSelect = (key: ScenarioKey) => {
    const next = new URLSearchParams(params);
    next.set("s", key);
    setParams(next, { replace: true });
  };

  return (
    <div className="chat-selection-root flex h-screen flex-col bg-background text-foreground">
      <PlaygroundScenarioBar scenario={scenario} onSelect={handleSelect} />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <PlaygroundTranscript scenario={scenario} />
          </div>
        </div>
        <PlaygroundComposer scenario={scenario} />
      </main>
      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <code className="font-mono">?s={scenario}</code>
        <span className="mx-2">·</span>
        Dev only · import.meta.env.DEV
      </footer>
    </div>
  );
}
