import { useEffect, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Button } from "@proliferate/ui/primitives/Button";
import { ProliferateIcon, ProliferateIconResolve } from "@proliferate/ui/proliferate-icons";

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
] as const;

const BRAILLE_FRAME_INTERVAL_MS = 60;
const ICON_ENTER_MS = 700;
const ICON_HOLD_MS = 950;
const ICON_EXIT_MS = 220;
const BRAILLE_END_HOLD_MS = 120;
const REDIRECT_MARK_LAYER_CLASS = "absolute inset-0 flex items-center justify-center";

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
  const iconClassName = "size-12 text-foreground";
  const brailleFrame = BRAILLE_SWEEP_FRAMES[brailleIndex] ?? BRAILLE_SWEEP_FRAMES[0];

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

  return (
    <div
      aria-hidden="true"
      className="relative size-12 shrink-0 overflow-hidden"
      data-testid="redirect-callback-living-mark"
    >
      {phase === "braille" ? (
        <div
          className={REDIRECT_MARK_LAYER_CLASS}
          data-testid="redirect-callback-braille-layer"
        >
          <span className="inline-block w-[1em] shrink-0 font-mono text-5xl leading-none tracking-[-0.18em] text-foreground">
            {brailleFrame}
          </span>
        </div>
      ) : null}
      {phase === "icon-enter" ? (
        <div
          className={REDIRECT_MARK_LAYER_CLASS}
          data-testid="redirect-callback-icon-layer"
        >
          <ProliferateIconResolve key={cycle} className={iconClassName} />
        </div>
      ) : null}
      {phase === "icon-hold" ? (
        <div
          className={REDIRECT_MARK_LAYER_CLASS}
          data-testid="redirect-callback-icon-layer"
        >
          <ProliferateIcon className={iconClassName} />
        </div>
      ) : null}
      {phase === "icon-exit" ? (
        <div
          className={twMerge(REDIRECT_MARK_LAYER_CLASS, "animate-brand-mark-fade-out")}
          data-testid="redirect-callback-icon-layer"
        >
          <ProliferateIcon className={iconClassName} />
        </div>
      ) : null}
    </div>
  );
}
