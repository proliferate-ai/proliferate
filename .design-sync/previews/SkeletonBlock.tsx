import { SkeletonBlock } from "@proliferate/ui";

export const Blocks = () => (
  <div className="flex w-64 flex-col gap-2">
    <SkeletonBlock className="h-4 w-32" />
    <SkeletonBlock className="h-4 w-48" />
    <SkeletonBlock className="h-4 w-24" />
  </div>
);

export const RowPlaceholder = () => (
  <div className="flex w-64 items-center gap-3">
    <SkeletonBlock className="size-8 rounded-full" />
    <div className="flex flex-1 flex-col gap-1.5">
      <SkeletonBlock className="h-3 w-28" />
      <SkeletonBlock className="h-3 w-40" />
    </div>
  </div>
);
