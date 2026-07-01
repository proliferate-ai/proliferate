import { useId } from "react";
import { twMerge } from "tailwind-merge";

interface CloudChatWorkspaceLoadingStateProps {
  label?: string;
  description?: string;
  className?: string;
}

export function CloudChatWorkspaceLoadingState({
  label = "Loading workspace",
  description = "Fetching sessions and transcript.",
  className = "",
}: CloudChatWorkspaceLoadingStateProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div
      className={twMerge("flex h-full flex-col bg-background text-foreground", className)}
      role="status"
      aria-live="polite"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <SkeletonBlock className="h-7 w-40 bg-muted/45" />
        <div className="min-w-0 flex-1" aria-hidden="true" />
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <SkeletonBlock className="h-6 w-24 rounded-full bg-muted/40" />
          <SkeletonBlock className="h-7 w-28 rounded-md bg-muted/35" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-6 py-10">
          <div className="-mt-16 flex flex-col items-center text-center">
            <div className="flex w-36 flex-col items-center gap-2" aria-hidden="true">
              <SkeletonBlock className="h-2 w-24" />
              <SkeletonBlock className="h-2 w-36 bg-muted/45" />
            </div>
            <p
              id={labelId}
              className="mt-4 text-chat font-medium leading-[var(--text-chat--line-height)] text-muted-foreground"
            >
              {label}
            </p>
            <p
              id={descriptionId}
              className="mt-1 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground/80"
            >
              {description}
            </p>
          </div>
        </div>
      </div>

      <footer className="relative z-20 shrink-0 border-t border-border/40 px-6 py-4">
        <div className="mx-auto w-full max-w-3xl rounded-[var(--radius-composer,1rem)] bg-foreground/5 p-3">
          <SkeletonBlock className="h-3 w-44 bg-muted/45" />
          <div className="mt-5 flex items-center justify-between gap-3" aria-hidden="true">
            <SkeletonBlock className="h-7 w-28 rounded-full bg-muted/35" />
            <SkeletonBlock className="size-7 rounded-full bg-muted/45" />
          </div>
        </div>
      </footer>
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
