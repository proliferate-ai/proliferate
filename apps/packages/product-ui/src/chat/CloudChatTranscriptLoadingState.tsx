import type { CSSProperties } from "react";
import { SkeletonBlock } from "@proliferate/ui/primitives/Skeleton";

/** Stagger each row's shimmer sweep so the fake conversation reads top-down. */
function rowDelay(row: number): CSSProperties {
  return { "--shimmer-delay": `${row * 120}ms` } as CSSProperties;
}

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
            <SkeletonBlock className="h-3 w-3/4" style={rowDelay(0)} />
            <SkeletonBlock className="h-3 w-2/3 bg-muted/45" style={rowDelay(1)} />
            <SkeletonBlock className="h-3 w-1/3 bg-muted/35" style={rowDelay(2)} />
          </div>
          <div className="ml-auto flex w-4/5 flex-col items-end gap-2" aria-hidden="true">
            <SkeletonBlock className="h-3 w-full bg-muted/45" style={rowDelay(3)} />
            <SkeletonBlock className="h-3 w-1/2 bg-muted/35" style={rowDelay(4)} />
          </div>
          <div className="flex flex-col gap-2" aria-hidden="true">
            <SkeletonBlock className="h-3 w-2/3" style={rowDelay(5)} />
            <SkeletonBlock className="h-3 w-5/6 bg-muted/45" style={rowDelay(6)} />
            <SkeletonBlock className="h-3 w-1/2 bg-muted/35" style={rowDelay(7)} />
          </div>
        </div>
      </div>
    </div>
  );
}
