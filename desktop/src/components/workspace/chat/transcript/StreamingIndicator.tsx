import { useEffect, useState } from "react";
import { useBrailleSweep } from "@/hooks/ui/use-braille-sweep";

interface StreamingIndicatorProps {
  startedAt?: string | null;
}

export function StreamingIndicator({ startedAt }: StreamingIndicatorProps) {
  const [elapsed, setElapsed] = useState(() => computeElapsed(startedAt));
  const frame = useBrailleSweep();

  useEffect(() => {
    setElapsed(computeElapsed(startedAt));
    const id = setInterval(() => {
      setElapsed(computeElapsed(startedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="flex items-end gap-1 py-1 text-muted-foreground">
      <span className="inline-block w-[1.25em] font-mono text-[1.125rem] leading-none tracking-[-0.18em] text-foreground">
        {frame}
      </span>
      <span className="text-[0.5rem] leading-none tabular-nums">{elapsed}s</span>
    </div>
  );
}

function computeElapsed(startedAt?: string | null): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}
