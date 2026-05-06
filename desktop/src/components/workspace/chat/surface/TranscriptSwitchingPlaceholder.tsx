import { DebugProfiler } from "@/components/ui/DebugProfiler";

export function TranscriptSwitchingPlaceholder() {
  return (
    <DebugProfiler id="session-transcript-pane">
      <div
        className="flex h-full min-h-0 items-center justify-center text-muted-foreground"
        role="status"
        aria-label="Switching chat"
        data-chat-switching-placeholder
      >
        <div className="flex w-full max-w-[14rem] flex-col items-center gap-2 px-6">
          <div className="h-px w-full bg-border" aria-hidden="true" />
        <span className="text-[11px] font-medium uppercase text-muted-foreground/70">
            Switching chat
          </span>
        </div>
      </div>
    </DebugProfiler>
  );
}
