import { useSearchParams } from "react-router-dom";
import { PlaygroundComposer } from "@/components/playground/PlaygroundComposer";
import { PlaygroundScenarioBar } from "@/components/playground/PlaygroundScenarioBar";
import { PlaygroundSidebarGitDiff } from "@/components/playground/PlaygroundSidebarGitDiff";
import { PlaygroundTranscript } from "@/components/playground/PlaygroundTranscript";
import {
  resolvePlaygroundScenarioSelection,
  type ScenarioKey,
} from "@/config/playground";
import { CHAT_COLUMN_CLASSNAME, CHAT_SURFACE_GUTTER_CLASSNAME } from "@/config/chat-layout";
import { useChatDockInset } from "@/hooks/chat/use-chat-dock-inset";
import { useReplaySession } from "@/hooks/playground/use-replay-session";

export function ChatPlaygroundPage() {
  const [params, setParams] = useSearchParams();
  const selection = resolvePlaygroundScenarioSelection(params.get("s"));
  const {
    dockRef,
    lowerBackdropTopPx,
    scrollBottomInsetPx,
    stickyBottomInsetPx,
  } = useChatDockInset();
  const replay = useReplaySession(
    selection.kind === "recording" ? selection.recordingId : null,
  );
  const showSidebarGitDiff =
    selection.kind === "fixture" && selection.key === "git-diff-panel";

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
      <main className="relative flex flex-1 overflow-hidden">
        <div
          className="flex-1 overflow-y-auto pt-6"
          style={{ paddingBottom: scrollBottomInsetPx }}
        >
          <div className={CHAT_SURFACE_GUTTER_CLASSNAME}>
            <div className={`${CHAT_COLUMN_CLASSNAME} flex flex-col gap-6`}>
              <PlaygroundTranscript
                selection={selection}
                replay={replay}
                stickyBottomInsetPx={stickyBottomInsetPx}
              />
            </div>
          </div>
        </div>
        <PlaygroundComposer
          dockRef={dockRef}
          lowerBackdropTopPx={lowerBackdropTopPx}
          selection={selection}
          replay={replay}
        />
        {showSidebarGitDiff && (
          <aside className="hidden w-[22rem] shrink-0 border-l border-sidebar-border bg-sidebar-background lg:block">
            <PlaygroundSidebarGitDiff />
          </aside>
        )}
      </main>
      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <code className="font-mono">?s={selection.raw}</code>
        <span className="mx-2">·</span>
        Dev only · import.meta.env.DEV
      </footer>
    </div>
  );
}
