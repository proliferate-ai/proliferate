import { useEffect, useState, type ReactNode } from "react";
import { motion } from "@proliferate/design/motion";

/**
 * Gates a subtree behind the shared loading show-delay (UX Latency +
 * Transitions ADR §4.2/§4.3, `motion.loading.showDelayMs`) for the one place
 * `LoadingBoundary` cannot reach: a `Suspense` `fallback`. React swaps a
 * `Suspense` boundary's whole subtree the instant the lazy import resolves,
 * so there is no `pending -> ready` state transition to hand `LoadingBoundary`
 * — the fallback tree is simply unmounted. `DelayedMount` reproduces the
 * show-delay half of that contract (children render only after the window
 * elapses) so a cold-chunk `Suspense` boundary still stays treatment-free for
 * fast loads; `Suspense` itself already provides the other half for free
 * (nothing renders past the resolved content once mounted, so there is no
 * flicker-hold to reproduce).
 */
export function DelayedMount({
  children,
  delayMs = motion.loading.showDelayMs,
}: {
  children: ReactNode;
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) {
    return null;
  }

  return <>{children}</>;
}
