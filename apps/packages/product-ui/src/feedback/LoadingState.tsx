import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface LoadingStateProps {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function LoadingState({
  label,
  description,
  className = "",
}: LoadingStateProps) {
  return (
    <div
      className={twMerge(
        "flex h-full items-center justify-center bg-background px-6 text-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center text-center">
        <div className="flex w-36 flex-col items-center gap-2" aria-hidden="true">
          <SkeletonBlock className="h-2 w-24" />
          <SkeletonBlock className="h-2 w-36 bg-muted/45" />
        </div>
        <p className="mt-4 text-sm font-medium text-muted-foreground">{label}</p>
        {description ? (
          <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground/80">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={twMerge("block rounded-md bg-muted/60 motion-safe:animate-pulse", className)}
    />
  );
}
