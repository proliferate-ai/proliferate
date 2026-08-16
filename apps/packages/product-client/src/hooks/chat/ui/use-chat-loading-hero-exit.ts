import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "@proliferate/design/motion";

export type ChatLoadingHeroExitPhase = "idle" | "holding" | "fading";

/**
 * Owns the chat loading hero's R16 exit choreography: once the DotCellLoader
 * mark becomes visible, it must stay up for `motion.loading.heroMinDisplayMs`
 * even if `mode.kind` flips away sooner, then fade over `motion.duration.exitMs`.
 * `ChatLoadingHero` itself cannot honor this — `ChatView` unmounts it
 * synchronously the instant `mode.kind` changes — so this hook tracks the
 * shown timestamp and reports a `phase` that `ChatContent` uses to keep a
 * frozen exit overlay (`ChatLoadingHeroExitOverlay`) mounted past that
 * unmount, on top of whatever real content `mode.kind` has already switched
 * to underneath.
 *
 * A load that never crosses the show-delay (mark never became visible) has
 * nothing to hold: `phase` stays `"idle"` and the mode switch takes effect
 * immediately, same as before R16.
 */
export function useChatLoadingHeroExit(isHeroMode: boolean): {
  phase: ChatLoadingHeroExitPhase;
  handleTreatmentShown: () => void;
} {
  const [phase, setPhase] = useState<ChatLoadingHeroExitPhase>("idle");
  const shownAtRef = useRef<number | null>(null);
  const prevHeroModeRef = useRef(isHeroMode);

  const handleTreatmentShown = useCallback(() => {
    shownAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    const wasHeroMode = prevHeroModeRef.current;
    prevHeroModeRef.current = isHeroMode;

    if (isHeroMode) {
      // Back in (or still in) hero mode: any prior exit overlay is stale.
      setPhase("idle");
      return;
    }
    if (!wasHeroMode) {
      // Wasn't in hero mode last render either — no exit to run.
      return;
    }

    const shownAt = shownAtRef.current;
    if (shownAt == null) {
      // The mark never became visible (still inside the show-delay when the
      // mode flipped away) — nothing to hold, no overlay needed.
      return;
    }

    const elapsedMs = Date.now() - shownAt;
    const remainingMs = Math.max(0, motion.loading.heroMinDisplayMs - elapsedMs);
    setPhase("holding");
    const holdTimer = window.setTimeout(() => setPhase("fading"), remainingMs);
    return () => window.clearTimeout(holdTimer);
  }, [isHeroMode]);

  useEffect(() => {
    if (phase !== "fading") {
      return;
    }
    const fadeTimer = window.setTimeout(() => {
      setPhase("idle");
      shownAtRef.current = null;
    }, motion.duration.exitMs);
    return () => window.clearTimeout(fadeTimer);
  }, [phase]);

  return { phase, handleTreatmentShown };
}
