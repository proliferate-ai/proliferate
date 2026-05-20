import { SkeletonBlock } from "@/components/feedback/Skeleton";

/**
 * Full loading state: icon + message + optional subtext.
 */
export function LoadingState({
  message = "Loading",
  subtext,
}: {
  message?: string;
  subtext?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6">
      <div className="flex w-28 flex-col items-center gap-2" aria-hidden="true">
        <SkeletonBlock className="h-2 w-20" />
        <SkeletonBlock className="h-2 w-28 bg-muted/45" />
      </div>
      <div className="text-center mt-1">
        <p className="text-sm font-medium text-foreground">{message}</p>
        {subtext && (
          <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
        )}
      </div>
    </div>
  );
}
