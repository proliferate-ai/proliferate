import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

interface AuthHandoffScreenProps {
  title: string;
  description: string;
  stateLabel: string;
  tone?: "default" | "error";
  primaryActionLabel?: string;
  primaryActionHref?: string;
  secondaryActionLabel?: string;
  secondaryActionHref?: string;
}

export function AuthHandoffScreen({
  title,
  description,
  stateLabel,
  tone = "default",
  primaryActionLabel,
  primaryActionHref,
  secondaryActionLabel,
  secondaryActionHref,
}: AuthHandoffScreenProps) {
  const Icon = tone === "error" ? AlertTriangle : CheckCircle2;
  const openHref = (href: string) => {
    window.location.assign(href);
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-floating">
        <div
          className={`mb-4 flex size-10 items-center justify-center rounded-md ${
            tone === "error" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
          }`}
        >
          <Icon size={20} />
        </div>
        <p className="text-xs font-medium uppercase text-muted-foreground">{stateLabel}</p>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
        {primaryActionLabel && primaryActionHref ? (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => openHref(primaryActionHref)}>
              <ExternalLink size={15} />
              {primaryActionLabel}
            </Button>
            {secondaryActionLabel && secondaryActionHref ? (
              <Button variant="secondary" onClick={() => openHref(secondaryActionHref)}>
                {secondaryActionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
