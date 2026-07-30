import { useEffect, useRef, useState } from "react";
import { motion } from "@proliferate/design/motion";

export interface TypewriterRevealTextProps {
  /** The label to render. */
  text: string;
  /**
   * True once the value is a real assigned name rather than a placeholder.
   * The reveal runs on the first render where this flips to true and never
   * again, so later renames and ordinary rerenders show the text immediately.
   */
  revealOnFirstAssignment: boolean;
}

/**
 * Reveals a label one character at a time the FIRST time it is assigned.
 *
 * Two guards, both refs rather than state, so neither survives as a rerender
 * trigger and neither can fire twice:
 *
 * - A tab that MOUNTS already named (app reload, restored session) is latched
 *   as already-revealed on its first render. Only a false → true transition of
 *   `revealOnFirstAssignment` animates, which is the moment a session actually
 *   gets titled.
 * - After that transition the latch closes for this element's lifetime, so
 *   subsequent renames and ordinary rerenders render the text whole. Callers
 *   keep the React key stable across a rename for that to hold.
 *
 * Reduced motion skips the character clock entirely and renders the final
 * text, since a partially typed label is not a calmer UI — it is a wrong one.
 */
export function TypewriterRevealText({
  text,
  revealOnFirstAssignment,
}: TypewriterRevealTextProps) {
  // Latched true when the very first render already had a name, so mounting an
  // already-titled tab never types.
  const hasRevealedRef = useRef(revealOnFirstAssignment);
  const [revealedCount, setRevealedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!revealOnFirstAssignment || hasRevealedRef.current || text.length === 0) {
      return;
    }
    hasRevealedRef.current = true;

    if (prefersReducedMotion()) {
      return;
    }

    const total = text.length;
    const stepMs = Math.max(1, Math.round(motion.activity.tabNameRevealMs / total));
    setRevealedCount(0);
    const interval = window.setInterval(() => {
      setRevealedCount((current) => {
        const next = (current ?? 0) + 1;
        if (next >= total) {
          window.clearInterval(interval);
          return null;
        }
        return next;
      });
    }, stepMs);
    return () => {
      window.clearInterval(interval);
      setRevealedCount(null);
    };
  }, [revealOnFirstAssignment, text]);

  const isRevealing = revealedCount !== null;

  // Renders no wrapper element at rest: the caller's own label element keeps
  // owning the text node, so its type role and truncation classes still apply
  // to the element that actually contains the label.
  if (!isRevealing) {
    return <>{text}</>;
  }

  return (
    <>
      {/* The typed slice is hidden from assistive tech while it grows; the
          full label rides along out of layout so the accessible name is
          stable and never announces a half-written title. */}
      <span aria-hidden="true" data-tab-name-revealing="true">
        {text.slice(0, revealedCount ?? 0)}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
