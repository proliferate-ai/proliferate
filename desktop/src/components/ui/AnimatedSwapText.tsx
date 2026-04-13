import { useEffect, useState } from "react";

const ANIMATION_DURATION_MS = 200;

export function AnimatedSwapText({ value }: { value: string }) {
  const [transition, setTransition] = useState<{
    outgoing: string | null;
    incoming: string;
    active: boolean;
  }>({
    outgoing: null,
    incoming: value,
    active: false,
  });

  useEffect(() => {
    if (value === transition.incoming) {
      return;
    }

    const nextIncoming = value;
    setTransition({
      outgoing: transition.incoming,
      incoming: nextIncoming,
      active: false,
    });

    const frame = window.requestAnimationFrame(() => {
      setTransition((current) => ({ ...current, active: true }));
    });
    const timer = window.setTimeout(() => {
      setTransition({
        outgoing: null,
        incoming: nextIncoming,
        active: false,
      });
    }, ANIMATION_DURATION_MS);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [transition.incoming, value]);

  return (
    <span className="relative block h-[18px] min-w-0 overflow-hidden">
      {transition.outgoing && (
        <span
          aria-hidden="true"
          className={`absolute inset-0 block truncate transition-all duration-200 ${
            transition.active
              ? "-translate-y-3 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
        >
          {transition.outgoing}
        </span>
      )}
      <span
        className={`block truncate transition-all duration-200 ${
          transition.outgoing
            ? transition.active
              ? "translate-y-0 opacity-100"
              : "translate-y-3 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        {transition.incoming}
      </span>
    </span>
  );
}
