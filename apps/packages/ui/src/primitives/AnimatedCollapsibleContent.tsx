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
      style={{
        gridTemplateRows: expanded ? "1fr" : "0fr",
        transitionProperty: "grid-template-rows, opacity",
      }}
      className={`grid duration-200 ease-out motion-reduce:transition-none ${
        expanded
          ? "opacity-100"
          : "pointer-events-none opacity-0"
      } ${className}`}
    >
      <div className="min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
