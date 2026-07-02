import type { CSSProperties } from "react";
import { SessionCheckScreen } from "@/components/auth/SessionCheckScreen";
import { SkeletonBlock } from "@/components/feedback/Skeleton";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { PlaygroundThinkingTimingControls } from "@/components/playground/loading/PlaygroundThinkingTimingControls";
import { StreamingIndicator } from "@/components/workspace/chat/transcript/StreamingIndicator";
import { renderChatTabIcon } from "@/components/workspace/shell/tabs/tab-rendering";

/** Stagger sibling skeleton rows so the sweep reads top-down (120ms/row). */
function shimmerDelay(row: number): CSSProperties {
  return { "--shimmer-delay": `${row * 120}ms` } as CSSProperties;
}

export function PlaygroundLoadingStates() {
  return (
    <div className="flex flex-col gap-8" data-playground-loading-states>
      <section className="overflow-hidden rounded-md border border-border">
        <SessionCheckScreen resolving className="min-h-[20rem] p-6" />
      </section>

      {/* One motion family, side by side: the thinking-text band sweep and
          the skeleton block sweep share direction, softness, and pacing. */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">
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
        <h2 className="text-sm font-medium text-foreground">Session tabs</h2>
        <div className="inline-flex h-9 min-w-48 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground">
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
          <h2 className="text-sm font-medium text-foreground">Sidebar skeleton</h2>
          <div className="flex flex-col gap-1">
            <SkeletonBlock className="h-7 w-full bg-sidebar-accent" />
            <SkeletonBlock className="h-7 w-[86%] bg-sidebar-accent/80" />
            <SkeletonBlock className="h-7 w-[70%] bg-sidebar-accent/70" />
          </div>
        </div>
        <div className="rounded-md border border-border p-4">
          <LoadingState message="Loading file" subtext="README.md" />
        </div>
      </section>
    </div>
  );
}
