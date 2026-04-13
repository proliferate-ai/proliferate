import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";
import { ProliferateIcon, ProliferateIconResolve } from "@/components/ui/icons";
import {
  BRAILLE_SWEEP_FRAMES,
  BRAILLE_SWEEP_FRAME_INTERVAL_MS,
} from "@/hooks/ui/use-braille-sweep";

const ICON_ENTER_MS = 700;
const ICON_HOLD_MS = 950;
const ICON_EXIT_MS = 220;
const BRAILLE_END_HOLD_MS = 120;

interface ProliferateLivingMarkProps {
  className?: string;
}

export function ProliferateLivingMark({ className }: ProliferateLivingMarkProps) {
  const [phase, setPhase] = useState<"braille" | "icon-enter" | "icon-hold" | "icon-exit">(
    "braille",
  );
  const [cycle, setCycle] = useState(0);
  const [brailleIndex, setBrailleIndex] = useState(0);
  const iconClassName = twMerge("size-12 text-foreground", className);
  const brailleClassName = twMerge(
    "inline-block w-[1em] shrink-0 font-mono text-5xl leading-none tracking-[-0.18em] text-foreground",
    className,
  );

  useEffect(() => {
    if (phase !== "braille") {
      return;
    }

    setBrailleIndex(0);

    const timer = setInterval(() => {
      setBrailleIndex((current) => {
        if (current >= BRAILLE_SWEEP_FRAMES.length - 1) {
          return current;
        }
        return current + 1;
      });
    }, BRAILLE_SWEEP_FRAME_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "braille" || brailleIndex < BRAILLE_SWEEP_FRAMES.length - 1) {
      return;
    }

    const timer = setTimeout(() => {
      setCycle((current) => current + 1);
      setPhase("icon-enter");
    }, BRAILLE_END_HOLD_MS);

    return () => clearTimeout(timer);
  }, [brailleIndex, phase]);

  useEffect(() => {
    if (phase !== "icon-enter") {
      return;
    }

    const timer = setTimeout(() => setPhase("icon-hold"), ICON_ENTER_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "icon-hold") {
      return;
    }

    const timer = setTimeout(() => setPhase("icon-exit"), ICON_HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "icon-exit") {
      return;
    }

    const timer = setTimeout(() => setPhase("braille"), ICON_EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div className="flex size-12 items-center justify-center">
      {phase === "braille" && (
        <LivingBrailleMark
          className={brailleClassName}
          frame={BRAILLE_SWEEP_FRAMES[brailleIndex] ?? BRAILLE_SWEEP_FRAMES[0]}
        />
      )}
      {phase === "icon-enter" && (
        <ProliferateIconResolve key={cycle} className={iconClassName} />
      )}
      {phase === "icon-hold" && <ProliferateIcon className={iconClassName} />}
      {phase === "icon-exit" && (
        <div className="animate-brand-mark-fade-out">
          <ProliferateIcon className={iconClassName} />
        </div>
      )}
    </div>
  );
}

function LivingBrailleMark({
  className,
  frame,
}: {
  className?: string;
  frame: string;
}) {
  return (
    <span
      aria-hidden
      className={className}
    >
      {frame}
    </span>
  );
}
