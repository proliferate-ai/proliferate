import { useEffect, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Button } from "@proliferate/ui/primitives/Button";

export type RedirectCallbackTone = "neutral" | "success" | "error";

export interface RedirectCallbackAction {
  label: ReactNode;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface RedirectCallbackScreenProps {
  title: ReactNode;
  description: ReactNode;
  statusLabel: ReactNode;
  tone?: RedirectCallbackTone;
  detail?: ReactNode;
  brandMark?: ReactNode;
  brandLabel?: ReactNode;
  primaryAction?: RedirectCallbackAction;
  secondaryAction?: RedirectCallbackAction;
  className?: string;
  variant?: "default" | "handoff";
}

const toneClasses: Record<RedirectCallbackTone, string> = {
  neutral: "bg-foreground/5 text-muted-foreground",
  success: "bg-success/10 text-success",
  error: "bg-destructive/10 text-destructive",
};

const BRAILLE_SWEEP_FRAMES = [
  "⠁⠀",
  "⠋⠀",
  "⠟⠁",
  "⡿⠋",
  "⣿⠟",
  "⣿⡿",
  "⣿⣿",
  "⣾⣿",
  "⣴⣿",
  "⣠⣾",
  "⢀⣴",
  "⠀⣠",
  "⠀⢀",
  "⠀⠀",
] as const;

const BRAILLE_FRAME_INTERVAL_MS = 60;
const ICON_ENTER_MS = 700;
const ICON_HOLD_MS = 950;
const ICON_EXIT_MS = 220;
const BRAILLE_END_HOLD_MS = 120;

export function RedirectCallbackScreen({
  title,
  description,
  statusLabel,
  tone = "neutral",
  detail,
  brandMark,
  brandLabel = "Proliferate",
  primaryAction,
  secondaryAction,
  className = "",
  variant = "default",
}: RedirectCallbackScreenProps) {
  if (variant === "handoff") {
    return (
      <div
        className={twMerge(
          "flex min-h-screen flex-col items-center justify-center bg-background p-8 text-foreground",
          className,
        )}
      >
        <main className="w-full max-w-md space-y-8">
          <div className="space-y-5">
            <div className="flex size-12 items-center justify-center">
              {brandMark ?? <RedirectCallbackLivingMark />}
            </div>
            <div className="space-y-2.5">
              <h1 className="text-3xl font-semibold leading-tight text-foreground">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
              {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
            </div>
          </div>

          {primaryAction ? <RedirectCallbackButtonAction action={primaryAction} /> : null}
        </main>
      </div>
    );
  }

  return (
    <div
      className={twMerge(
        "flex min-h-screen items-center justify-center bg-background p-8 text-foreground",
        className,
      )}
    >
      <main className="w-full max-w-md space-y-8">
        {brandMark ? (
          <div className="flex items-center gap-3 text-foreground">
            <span className="flex size-10 shrink-0 items-center justify-start">{brandMark}</span>
            {brandLabel ? <span className="text-sm font-semibold">{brandLabel}</span> : null}
          </div>
        ) : null}

        <div className="space-y-5">
          <div
            className={twMerge(
              "inline-flex max-w-full items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium",
              toneClasses[tone],
            )}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-current" />
            <span className="min-w-0 truncate">{statusLabel}</span>
          </div>

          <div className="space-y-2.5">
            <h1 className="text-3xl font-semibold leading-tight text-foreground">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            {detail ? (
              <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
            ) : null}
          </div>
        </div>

        {primaryAction || secondaryAction ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {primaryAction ? (
              <RedirectCallbackButton action={primaryAction} className="w-full sm:w-auto" />
            ) : null}
            {secondaryAction ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={secondaryAction.disabled}
                onClick={secondaryAction.onClick}
                className="w-full sm:w-auto"
              >
                {secondaryAction.icon}
                {secondaryAction.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function RedirectCallbackButtonAction({ action }: { action: RedirectCallbackAction }) {
  return (
    <div className="space-y-4">
      <RedirectCallbackButton action={action} className="h-11 w-full" />
    </div>
  );
}

function RedirectCallbackButton({
  action,
  className,
}: {
  action: RedirectCallbackAction;
  className?: string;
}) {
  const handleClick = () => {
    if (action.onClick) {
      action.onClick();
      return;
    }
    if (action.href && typeof window !== "undefined") {
      window.location.assign(action.href);
    }
  };

  return (
    <Button
      type="button"
      size="md"
      disabled={action.disabled}
      onClick={handleClick}
      className={className}
    >
      {action.icon}
      {action.label}
    </Button>
  );
}

function RedirectCallbackLivingMark() {
  const [phase, setPhase] = useState<"braille" | "icon-enter" | "icon-hold" | "icon-exit">(
    "braille",
  );
  const [cycle, setCycle] = useState(0);
  const [brailleIndex, setBrailleIndex] = useState(0);

  useEffect(() => {
    if (phase !== "braille") {
      return;
    }

    setBrailleIndex(0);

    const timer = window.setInterval(() => {
      setBrailleIndex((current) => {
        if (current >= BRAILLE_SWEEP_FRAMES.length - 1) {
          return current;
        }
        return current + 1;
      });
    }, BRAILLE_FRAME_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "braille" || brailleIndex < BRAILLE_SWEEP_FRAMES.length - 1) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCycle((current) => current + 1);
      setPhase("icon-enter");
    }, BRAILLE_END_HOLD_MS);

    return () => window.clearTimeout(timer);
  }, [brailleIndex, phase]);

  useEffect(() => {
    if (phase !== "icon-enter") {
      return;
    }

    const timer = window.setTimeout(() => setPhase("icon-hold"), ICON_ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "icon-hold") {
      return;
    }

    const timer = window.setTimeout(() => setPhase("icon-exit"), ICON_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "icon-exit") {
      return;
    }

    const timer = window.setTimeout(() => setPhase("braille"), ICON_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "braille") {
    return (
      <span
        aria-hidden="true"
        className="inline-block w-[1em] shrink-0 font-mono text-5xl leading-none tracking-[-0.18em] text-foreground"
      >
        {BRAILLE_SWEEP_FRAMES[brailleIndex] ?? BRAILLE_SWEEP_FRAMES[0]}
      </span>
    );
  }

  return (
    <div className={phase === "icon-exit" ? "opacity-0 transition-opacity duration-200" : ""}>
      <RedirectCallbackMark key={cycle} className="size-12 text-foreground" />
    </div>
  );
}

function RedirectCallbackMark({ className }: { className?: string }) {
  const nodes = [
    { x: 375, y: 375, size: 50 },
    { x: 387.67, y: 305, size: 24.67 },
    { x: 429, y: 346.33, size: 24.67 },
    { x: 470.33, y: 387.67, size: 24.67 },
    { x: 429, y: 429, size: 24.67 },
    { x: 387.67, y: 470.33, size: 24.67 },
    { x: 346.33, y: 429, size: 24.67 },
    { x: 305, y: 387.67, size: 24.67 },
    { x: 346.33, y: 346.33, size: 24.67 },
  ];

  return (
    <svg
      className={className}
      viewBox="300 300 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {nodes.map((node, index) => (
        <rect
          key={`redirect-callback-mark-${index}`}
          x={node.x}
          y={node.y}
          width={node.size}
          height={node.size}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
