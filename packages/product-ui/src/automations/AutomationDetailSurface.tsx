import { ArrowLeft, Pause, Pencil, Play, Zap } from "lucide-react";
import { type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import type {
  AutomationInventoryItemView,
  AutomationRunInventoryItemView,
} from "@proliferate/product-model/automations/inventory";
import { ProductNotice } from "../layout/ProductNotice";
import { ProductPageShell } from "../layout/ProductPageShell";
import { AutomationRunsList } from "./AutomationRunsList";

export interface AutomationDetailSurfaceProps {
  automation: AutomationInventoryItemView | null;
  runs: readonly AutomationRunInventoryItemView[];
  loadingAutomation?: boolean;
  loadingRuns?: boolean;
  notFound?: boolean;
  actionError?: string | null;
  busy?: boolean;
  maxWidthClassName?: string;
  onBack: () => void;
  onRunNow?: (automationId: string) => void;
  onEdit?: (automationId: string) => void;
  onPause?: (automationId: string) => void;
  onResume?: (automationId: string) => void;
  onRunSelect?: (runId: string) => void;
}

export function AutomationDetailSurface({
  automation,
  runs,
  loadingAutomation = false,
  loadingRuns = false,
  notFound = false,
  actionError = null,
  busy = false,
  maxWidthClassName = "max-w-none",
  onBack,
  onRunNow,
  onEdit,
  onPause,
  onResume,
  onRunSelect,
}: AutomationDetailSurfaceProps) {
  const title = automation?.title ?? "Automation";

  return (
    <ProductPageShell
      title={title}
      description={automation ? <AutomationDetailDescription automation={automation} /> : "Loading automation..."}
      actions={automation ? (
        <AutomationDetailActions
          automation={automation}
          busy={busy}
          onRunNow={onRunNow}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
        />
      ) : null}
      maxWidthClassName={maxWidthClassName}
      telemetryBlocked
    >
      <div className="pb-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-4">
          <ArrowLeft className="size-4" aria-hidden />
          Automations
        </Button>

        {actionError ? (
          <ProductNotice
            tone="destructive"
            title="Automation action failed"
            description={actionError}
            className="mb-4"
          />
        ) : null}

        {notFound ? (
          <section className="py-3">
            <p className="text-sm font-medium text-foreground">Automation not found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              It may have been deleted or you may not have access to it.
            </p>
          </section>
        ) : loadingAutomation && !automation ? (
          <div className="py-4 text-xs text-muted-foreground" role="status" aria-live="polite">
            Loading automation
          </div>
        ) : (
          <section className="min-w-0">
            <div className="mt-1 flex h-9 w-full items-center gap-2 rounded-[10px] bg-foreground/[0.042] px-3">
              <span className="text-sm font-medium leading-5 text-foreground">Run history</span>
              <span className="text-sm tabular-nums text-muted-foreground">{runs.length}</span>
            </div>
            <AutomationRunsList
              runs={runs}
              loading={loadingRuns}
              onRunSelect={onRunSelect}
            />
          </section>
        )}
      </div>
    </ProductPageShell>
  );
}

function AutomationDetailDescription({
  automation,
}: {
  automation: AutomationInventoryItemView;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="truncate">{automation.repoLabel}</span>
      <span aria-hidden="true">·</span>
      <span>{automation.scopeLabel}</span>
      <span aria-hidden="true">·</span>
      <span>{automation.targetLabel}</span>
      <span aria-hidden="true">·</span>
      <span>{automation.scheduleLabel}</span>
      <span aria-hidden="true">·</span>
      <span>{automation.nextRunLabel}</span>
    </span>
  );
}

function AutomationDetailActions({
  automation,
  busy,
  onRunNow,
  onEdit,
  onPause,
  onResume,
}: {
  automation: AutomationInventoryItemView;
  busy: boolean;
  onRunNow?: (automationId: string) => void;
  onEdit?: (automationId: string) => void;
  onPause?: (automationId: string) => void;
  onResume?: (automationId: string) => void;
}) {
  const runDisabledReason = automation.runNowDisabledReason
    ?? (!automation.enabled ? "Resume before queueing a run." : null);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {onRunNow ? (
        <DetailActionButton
          label="Run now"
          disabled={busy || Boolean(runDisabledReason)}
          softDisabledReason={runDisabledReason}
          onClick={() => onRunNow(automation.id)}
        >
          <Zap className="size-4" aria-hidden />
          Run now
        </DetailActionButton>
      ) : null}
      {onEdit ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(automation.id)}
          disabled={busy}
        >
          <Pencil className="size-4" aria-hidden />
          Edit
        </Button>
      ) : null}
      {automation.enabled ? (
        onPause ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPause(automation.id)}
            disabled={busy}
          >
            <Pause className="size-4" aria-hidden />
            Pause
          </Button>
        ) : null
      ) : onResume ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onResume(automation.id)}
          disabled={busy}
        >
          <Play className="size-4" aria-hidden />
          Resume
        </Button>
      ) : null}
    </div>
  );
}

function DetailActionButton({
  children,
  label,
  disabled,
  softDisabledReason,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled: boolean;
  softDisabledReason: string | null;
  onClick: () => void;
}) {
  const softDisabled = Boolean(softDisabledReason);
  const accessibleLabel = softDisabledReason ? `${label}: ${softDisabledReason}` : label;
  return (
    <Button
      variant="ghost"
      size="sm"
      title={softDisabledReason ?? label}
      aria-label={accessibleLabel}
      aria-disabled={softDisabled || undefined}
      disabled={!softDisabled && disabled}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      className="aria-disabled:cursor-default aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent"
    >
      {children}
    </Button>
  );
}
