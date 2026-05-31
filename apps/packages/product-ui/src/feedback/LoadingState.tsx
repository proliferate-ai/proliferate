import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { ProliferateLivingMark } from "../brand/ProliferateLivingMark";

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
        <ProliferateLivingMark />
        <p className="mt-5 text-sm font-medium text-foreground">{label}</p>
        {description ? (
          <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground/80">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
