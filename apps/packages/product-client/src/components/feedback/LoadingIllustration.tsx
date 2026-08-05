import { SkeletonBlock } from "#product/primitives/Skeleton";

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
        <p className="text-body-emphasis font-medium text-foreground">{message}</p>
        {subtext && (
          <p className="mt-1 text-ui-sm text-muted-foreground">{subtext}</p>
        )}
      </div>
    </div>
  );
}
