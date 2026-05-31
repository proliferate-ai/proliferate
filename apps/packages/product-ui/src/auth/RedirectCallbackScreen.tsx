import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Button } from "@proliferate/ui/primitives/Button";
import { ProliferateLivingMark } from "../brand/ProliferateLivingMark";

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
              {brandMark ?? (
                <ProliferateLivingMark
                  testIds={{
                    root: "redirect-callback-living-mark",
                    brailleLayer: "redirect-callback-braille-layer",
                    iconLayer: "redirect-callback-icon-layer",
                  }}
                />
              )}
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
