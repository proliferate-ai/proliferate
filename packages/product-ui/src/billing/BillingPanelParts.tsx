import type { ReactNode } from "react";
import { AlertTriangle, Info, LoaderCircle } from "lucide-react";

import type {
  BillingMetricView,
  BillingNoticeView,
  BillingStatusView,
} from "@proliferate/product-model/billing/model";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";

export interface BillingPanelActionView {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function BillingPanelButton({
  action,
  variant = "secondary",
  className,
}: {
  action: BillingPanelActionView;
  variant?: "primary" | "secondary" | "outline" | "ghost";
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

export function BillingStatusBadge({ status }: { status: BillingStatusView }) {
  return <Badge tone={status.tone}>{status.label}</Badge>;
}

export function BillingPanelHeader({
  icon,
  title,
  description,
  status,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: BillingStatusView;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-light bg-foreground/5 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            <BillingStatusBadge status={status} />
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function BillingMetricGrid({ metrics }: { metrics: readonly BillingMetricView[] }) {
  if (metrics.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.id} className="min-w-0 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {metric.label}
          </div>
          <div className="truncate text-lg font-semibold text-foreground">{metric.value}</div>
          <div
            className={`text-xs leading-5 ${
              metric.tone === "destructive"
                ? "text-destructive"
                : metric.tone === "warning"
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
          >
            {metric.detail}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BillingNotice({
  notice,
  action,
}: {
  notice: BillingNoticeView;
  action?: BillingPanelActionView;
}) {
  const Icon = notice.tone === "info" ? Info : AlertTriangle;
  return (
    <div
      className={`flex gap-3 rounded-lg border p-3 text-sm ${
        notice.tone === "destructive"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : notice.tone === "info"
            ? "border-info/25 bg-info/10 text-info"
            : "border-warning/30 bg-warning/10 text-warning"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{notice.title}</div>
        <div className="mt-1 leading-5 opacity-90">{notice.description}</div>
      </div>
      {action ? (
        <BillingPanelButton action={action} variant="outline" className="ml-auto shrink-0" />
      ) : null}
    </div>
  );
}

export function BillingLoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
