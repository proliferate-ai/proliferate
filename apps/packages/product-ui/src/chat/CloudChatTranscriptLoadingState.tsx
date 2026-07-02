import { twMerge } from "@proliferate/ui/utils/tw-merge";

export function CloudChatTranscriptLoadingState() {
  return (
    <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-6">
        <div
          role="status"
          aria-label="Loading session content"
          className="flex min-h-[18rem] flex-col justify-center gap-8 py-8"
        >
          <div className="flex flex-col gap-2" aria-hidden="true">
            <TranscriptSkeletonBlock className="h-3 w-3/4" />
            <TranscriptSkeletonBlock className="h-3 w-2/3 bg-muted/45" />
            <TranscriptSkeletonBlock className="h-3 w-1/3 bg-muted/35" />
          </div>
          <div className="ml-auto flex w-4/5 flex-col items-end gap-2" aria-hidden="true">
            <TranscriptSkeletonBlock className="h-3 w-full bg-muted/45" />
            <TranscriptSkeletonBlock className="h-3 w-1/2 bg-muted/35" />
          </div>
          <div className="flex flex-col gap-2" aria-hidden="true">
            <TranscriptSkeletonBlock className="h-3 w-2/3" />
            <TranscriptSkeletonBlock className="h-3 w-5/6 bg-muted/45" />
            <TranscriptSkeletonBlock className="h-3 w-1/2 bg-muted/35" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TranscriptSkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <span className={twMerge("block rounded-md bg-muted/60 motion-safe:animate-pulse", className)} />
  );
}
