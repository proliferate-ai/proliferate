import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

import type { BillingActionView } from "./billing-types";

export function BillingButton({
  action,
  variant,
  className,
}: {
  action: BillingActionView;
  variant: "primary" | "secondary" | "outline";
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      loading={action.loading}
      disabled={action.disabled}
      onClick={action.onClick}
      className={className}
    >
      {action.label}
    </Button>
  );
}

export function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="truncate text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

export function Notice({
  action,
  tone,
  title,
  description,
}: {
  action?: BillingActionView;
  tone: "warning" | "destructive";
  title: string;
  description: ReactNode;
}) {
  return (
    <div
      className={`flex gap-3 rounded-lg border p-3 text-sm ${
        tone === "destructive"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-warning/30 bg-warning/10 text-warning"
      }`}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="mt-1 leading-5 opacity-90">{description}</div>
      </div>
      {action ? (
        <BillingButton action={action} variant="outline" className="ml-auto shrink-0" />
      ) : null}
    </div>
  );
}
