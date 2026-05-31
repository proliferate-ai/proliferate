import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import {
  ProliferateIcon,
  ProliferateIconResolve,
} from "@proliferate/ui/proliferate-icons";

export const BRAILLE_SWEEP_DOT_FRAMES = [
  [0],
  [0, 1, 4],
  [0, 1, 2, 4, 5, 8],
  [0, 1, 2, 3, 4, 5, 6, 8, 9, 12],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13],
  [0, 1, 2, 3, 4, 5, 6, 8, 9, 12],
  [0, 1, 2, 4, 5, 8],
  [0, 1, 4],
  [0],
] as const;

export const BRAILLE_SWEEP_FRAME_INTERVAL_MS = 60;

const BRAILLE_DOT_INDICES = Array.from({ length: 16 }, (_, index) => index);
const ICON_ENTER_MS = 700;
const ICON_HOLD_MS = 950;
const ICON_EXIT_MS = 220;
const BRAILLE_END_HOLD_MS = 120;
const MARK_LAYER_CLASS = "absolute inset-0 flex items-center justify-center";

interface ProliferateLivingMarkProps {
  className?: string;
  complete?: boolean;
  onResolved?: () => void;
  testIds?: {
    root?: string;
    brailleLayer?: string;
    iconLayer?: string;
  };
}

export function ProliferateLivingMark({
  className,
  complete = false,
  onResolved,
  testIds,
}: ProliferateLivingMarkProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const resolvedRef = useRef(false);
  const [phase, setPhase] = useState<"braille" | "icon-enter" | "icon-hold" | "icon-exit">(
    "braille",
  );
  const [cycle, setCycle] = useState(0);
  const [brailleIndex, setBrailleIndex] = useState(0);
  const iconClassName = twMerge("size-12 text-foreground", className);
  const brailleClassName = twMerge(
    "grid size-12 shrink-0 grid-cols-4 grid-rows-4 gap-1.5 text-foreground",
    className,
  );
  const visibleBrailleDots =
    BRAILLE_SWEEP_DOT_FRAMES[brailleIndex] ?? BRAILLE_SWEEP_DOT_FRAMES[0];

  useEffect(() => {
    if (prefersReducedMotion || phase !== "braille") {
      return;
    }

    setBrailleIndex(0);

    const timer = window.setInterval(() => {
      setBrailleIndex((current) => {
        if (current >= BRAILLE_SWEEP_DOT_FRAMES.length - 1) {
          return current;
        }
        return current + 1;
      });
    }, BRAILLE_SWEEP_FRAME_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [phase, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }
    if (phase !== "braille" || brailleIndex < BRAILLE_SWEEP_DOT_FRAMES.length - 1) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCycle((current) => current + 1);
      setPhase("icon-enter");
    }, BRAILLE_END_HOLD_MS);

    return () => window.clearTimeout(timer);
  }, [brailleIndex, phase, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || phase !== "icon-enter") {
      return;
    }

    const timer = window.setTimeout(() => setPhase("icon-hold"), ICON_ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || phase !== "icon-hold") {
      return;
    }

    if (complete) {
      if (resolvedRef.current) {
        return;
      }
      resolvedRef.current = true;
      const frame = window.requestAnimationFrame(() => onResolved?.());
      return () => window.cancelAnimationFrame(frame);
    }

    const timer = window.setTimeout(() => setPhase("icon-exit"), ICON_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [complete, onResolved, phase, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || phase !== "icon-exit") {
      return;
    }

    if (complete) {
      setPhase("icon-hold");
      return;
    }

    const timer = window.setTimeout(() => setPhase("braille"), ICON_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [complete, phase, prefersReducedMotion]);

  useEffect(() => {
    if (!prefersReducedMotion || !complete || resolvedRef.current) {
      return;
    }

    resolvedRef.current = true;
    const frame = window.requestAnimationFrame(() => onResolved?.());
    return () => window.cancelAnimationFrame(frame);
  }, [complete, onResolved, prefersReducedMotion]);

  if (prefersReducedMotion) {
    return (
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center"
        data-testid={testIds?.root}
      >
        <ProliferateIcon className={iconClassName} />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="relative size-12 shrink-0 overflow-hidden"
      data-testid={testIds?.root}
    >
      {phase === "braille" ? (
        <div className={MARK_LAYER_CLASS} data-testid={testIds?.brailleLayer}>
          <LivingBrailleMark className={brailleClassName} visibleDots={visibleBrailleDots} />
        </div>
      ) : null}
      {phase === "icon-enter" ? (
        <div className={MARK_LAYER_CLASS} data-testid={testIds?.iconLayer}>
          <ProliferateIconResolve key={cycle} className={iconClassName} />
        </div>
      ) : null}
      {phase === "icon-hold" ? (
        <div className={MARK_LAYER_CLASS} data-testid={testIds?.iconLayer}>
          <ProliferateIcon className={iconClassName} />
        </div>
      ) : null}
      {phase === "icon-exit" ? (
        <div
          className={twMerge(MARK_LAYER_CLASS, "animate-brand-mark-fade-out")}
          data-testid={testIds?.iconLayer}
        >
          <ProliferateIcon className={iconClassName} />
        </div>
      ) : null}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    handleChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return prefersReducedMotion;
}

function LivingBrailleMark({
  className,
  visibleDots,
}: {
  className?: string;
  visibleDots: readonly number[];
}) {
  const visibleDotSet = new Set(visibleDots);

  return (
    <span aria-hidden="true" className={className}>
      {BRAILLE_DOT_INDICES.map((dotIndex) => {
        const isVisible = visibleDotSet.has(dotIndex);

        return (
          <span
            key={dotIndex}
            className={twMerge(
              "block size-2 place-self-center rounded-full bg-current transition-opacity duration-100 ease-out",
              isVisible ? "opacity-100" : "opacity-0",
            )}
            data-braille-dot={dotIndex}
            data-visible={isVisible ? "true" : "false"}
          />
        );
      })}
    </span>
  );
}
