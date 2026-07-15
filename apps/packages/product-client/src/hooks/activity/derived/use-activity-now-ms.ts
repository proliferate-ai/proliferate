import { useEffect, useState } from "react";

const TICK_MS = 15_000;

/**
 * Ticking `Date.now()` for activity panels (loop next-fire, process/agent
 * elapsed labels) — a shared clock so a mounted panel stays live without
 * every row owning its own timer.
 */
export function useActivityNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return nowMs;
}
