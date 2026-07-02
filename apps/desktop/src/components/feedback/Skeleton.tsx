import { twMerge } from "@proliferate/ui/utils/tw-merge";

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={twMerge("block rounded-md bg-muted/60 motion-safe:animate-pulse", className)}
    />
  );
}
