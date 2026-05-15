import type {
  HTMLAttributes,
  ReactNode,
  RefObject,
} from "react";

export function WorkspaceTabStrip({
  label,
  stripRef,
  contentWidth,
  children,
  className = "",
  ...props
}: {
  label: string;
  stripRef?: RefObject<HTMLDivElement | null>;
  contentWidth?: number;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      className={`scrollbar-none relative min-w-0 overflow-x-auto overflow-y-hidden ${className}`}
      {...props}
    >
      <div
        className="relative h-full"
        style={{ width: contentWidth ? `${contentWidth}px` : "100%" }}
      >
        {children}
      </div>
    </div>
  );
}
