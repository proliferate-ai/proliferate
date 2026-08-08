import { useEffect, useState, type ReactNode } from "react";

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
  const [preparedExpanded, setPreparedExpanded] = useState(expanded);
  const visuallyExpanded = expanded && preparedExpanded;

  useEffect(() => {
    if (!expanded) {
      setPreparedExpanded(false);
      return;
    }
    if (preparedExpanded) return;

    // A newly mounted lazy subtree gets one collapsed commit before geometry
    // and opacity advance together. Closing cancels the frame through the
    // effect cleanup, including a callback already in flight.
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      setPreparedExpanded(true);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [expanded, preparedExpanded]);

  return (
    <div
      aria-hidden={!visuallyExpanded}
      data-animated-collapsible-content
      data-expanded={visuallyExpanded ? "true" : "false"}
      inert={!visuallyExpanded}
      style={{
        gridTemplateRows: visuallyExpanded ? "1fr" : "0fr",
        transitionProperty: "grid-template-rows, opacity",
      }}
      className={`grid duration-disclosure ease-out motion-reduce:transition-none ${
        visuallyExpanded
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
