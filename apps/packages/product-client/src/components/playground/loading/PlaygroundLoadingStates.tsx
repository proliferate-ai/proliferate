import { SessionCheckScreen } from "#product/components/auth/SessionCheckScreen";
import { SkeletonBlock, shimmerDelay } from "#product/components/feedback/Skeleton";
import { ThinkingText } from "#product/components/feedback/ThinkingText";
import { LoadingState } from "#product/components/feedback/LoadingIllustration";
import { ChatLoadingHero } from "#product/components/workspace/chat/surface/ChatLoadingHero";
import { ChatPreMessageCanvas } from "#product/components/workspace/chat/surface/ChatPreMessageCanvas";
import { PlaygroundThinkingTimingControls } from "#product/components/playground/loading/PlaygroundThinkingTimingControls";
import { StreamingIndicator } from "#product/components/workspace/chat/transcript/StreamingIndicator";
import { TranscriptSwitchingPlaceholder } from "#product/components/workspace/chat/surface/TranscriptSwitchingPlaceholder";
import { renderChatTabIcon } from "#product/components/workspace/shell/tabs/tab-rendering";

export function PlaygroundLoadingStates() {
  return (
    <div className="flex flex-col gap-8" data-playground-loading-states>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-md border border-border" style={{ height: "22rem" }}>
          <TranscriptSwitchingPlaceholder label="Desktop switching alignment" />
        </div>
        <div className="flex flex-col overflow-hidden rounded-md border border-border" style={{ height: "22rem" }}>
          {/* The REAL "session-loading" chat surface — ChatView routes here
              while a session is loading/hydrating. No fixture-only clone. */}
          <ChatPreMessageCanvas bottomInsetPx={0}>
            <ChatLoadingHero />
          </ChatPreMessageCanvas>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-border">
        <SessionCheckScreen resolving className="min-h-[20rem] p-6" />
      </section>

      {/* One motion family, side by side: the thinking-text band sweep and
          the skeleton block sweep share direction, softness, and pacing. */}
      <section className="space-y-3">
        <h2 className="text-heading font-medium text-foreground">
          Shimmer + staggered skeletons
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col justify-center gap-4 rounded-md border border-border p-4">
            <ThinkingText />
            <ThinkingText text="Searching the codebase" />
            <StreamingIndicator
              startedAt={new Date(Date.now() - 34_000).toISOString()}
            />
          </div>
          <div className="flex flex-col justify-center gap-2 rounded-md border border-border p-4">
            <SkeletonBlock className="h-3 w-3/4" style={shimmerDelay(0)} />
            <SkeletonBlock className="h-3 w-2/3 bg-muted/45" style={shimmerDelay(1)} />
            <SkeletonBlock className="h-3 w-5/6 bg-muted/45" style={shimmerDelay(2)} />
            <SkeletonBlock className="h-3 w-1/2 bg-muted/35" style={shimmerDelay(3)} />
          </div>
        </div>
      </section>

      <PlaygroundThinkingTimingControls />

      <section className="space-y-3">
        <h2 className="text-heading font-medium text-foreground">Session tabs</h2>
        <div className="inline-flex h-9 min-w-48 items-center gap-2 rounded-md border border-border px-3 text-ui text-muted-foreground">
          {renderChatTabIcon({
            agentKind: "",
            viewState: "idle",
            isResolvingSession: true,
            delegatedAgent: null,
          })}
          <span>Restoring session</span>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-md border border-border p-4">
          <h2 className="text-heading font-medium text-foreground">Sidebar skeleton</h2>
          <div className="flex flex-col gap-1">
            <SkeletonBlock className="h-7 w-full bg-surface-control" />
            <SkeletonBlock className="h-7 w-[86%] bg-surface-control/80" />
            <SkeletonBlock className="h-7 w-[70%] bg-surface-control/70" />
          </div>
        </div>
        <div className="rounded-md border border-border p-4">
          <LoadingState message="Loading file" subtext="README.md" />
        </div>
      </section>
    </div>
  );
}
