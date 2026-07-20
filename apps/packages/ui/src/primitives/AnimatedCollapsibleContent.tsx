import type { ReactNode } from "react";

interface AnimatedCollapsibleContentProps {
  expanded: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Height + opacity disclosure motion that keeps the expanding content in
 * normal flow. The inert collapsed subtree cannot receive keyboard focus.
 */
export function AnimatedCollapsibleContent({
  expanded,
  children,
  className = "",
}: AnimatedCollapsibleContentProps) {
  return (
    <div
      aria-hidden={!expanded}
      data-animated-collapsible-content
      data-expanded={expanded ? "true" : "false"}
      inert={!expanded}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        expanded
          ? "grid-rows-[1fr] opacity-100"
          : "pointer-events-none grid-rows-[0fr] opacity-0"
      } ${className}`}
    >
      <div className="min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
