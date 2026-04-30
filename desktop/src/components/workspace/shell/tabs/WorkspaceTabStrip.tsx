import type {
  HTMLAttributes,
  ReactNode,
  RefObject,
} from "react";

export function WorkspaceTabStrip({
  label,
  stripRef,
  children,
  className = "",
  ...props
}: {
  label: string;
  stripRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      className={`scrollbar-none relative min-w-0 overflow-hidden ${className}`}
      {...props}
    >
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}
