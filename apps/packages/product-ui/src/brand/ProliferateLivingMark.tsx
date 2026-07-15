import { useEffect, useRef } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { ProliferateIcon } from "@proliferate/ui/proliferate-icons";

interface ProliferateLivingMarkProps {
  className?: string;
  /** When the pending state resolved (session known); settles the mark. */
  complete?: boolean;
  /** Fires once (rAF-deferred) after `complete` turns true. */
  onResolved?: () => void;
  testIds?: {
    root?: string;
    iconLayer?: string;
  };
}

/**
 * The pre-app brand mark: the plain Proliferate icon, quietly alive.
 * While pending it breathes (slow opacity oscillation, compositor-only,
 * css `.animate-brand-mark-breathe`); on `complete` it takes one settling
 * breath to full presence and latches `onResolved` exactly once so gates
 * (AuthGate) can key their reveal off it. Reduced motion renders the same
 * static icon with no animation — geometry is identical in every state,
 * so the mark never shifts the layout around it.
 */
export function ProliferateLivingMark({
  className,
  complete = false,
  onResolved,
  testIds,
}: ProliferateLivingMarkProps) {
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (!complete || resolvedRef.current) {
      return;
    }
    resolvedRef.current = true;
    const frame = window.requestAnimationFrame(() => onResolved?.());
    return () => window.cancelAnimationFrame(frame);
  }, [complete, onResolved]);

  return (
    <div
      aria-hidden="true"
      className="flex size-12 shrink-0 items-center justify-center"
      data-testid={testIds?.root}
      data-brand-mark={complete ? "settled" : "breathing"}
    >
      <span
        className={twMerge(
          "flex",
          complete ? "animate-brand-mark-settle" : "animate-brand-mark-breathe",
        )}
        data-testid={testIds?.iconLayer}
      >
        <ProliferateIcon className={twMerge("size-12 text-foreground", className)} />
      </span>
    </div>
  );
}
