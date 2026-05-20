import { SessionCheckScreen } from "@/components/auth/SessionCheckScreen";
import { SkeletonBlock } from "@/components/feedback/Skeleton";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { renderChatTabIcon } from "@/components/workspace/shell/tabs/tab-rendering";

export function PlaygroundLoadingStates() {
  return (
    <div className="flex flex-col gap-8" data-playground-loading-states>
      <section className="overflow-hidden rounded-md border border-border">
        <SessionCheckScreen resolving className="min-h-[20rem] p-6" />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Agent thinking</h2>
        <div className="flex h-12 items-center rounded-md border border-border px-4">
          <ThinkingText />
        </div>
      </section>

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
