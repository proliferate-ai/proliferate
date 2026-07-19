import type {
  WorkflowRun,
  WorkflowRunPresentation,
} from "@proliferate/product-domain/workflows/run-presentation";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProductPageShell } from "../layout/ProductPageShell";

export interface WorkflowRunDetailProps {
  run: WorkflowRun;
  presentation: WorkflowRunPresentation;
  deliveryCapabilityEnabled?: boolean;
  busy?: boolean;
  actionError?: string | null;
  openSessionUnavailable?: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onStartDelivery: () => void;
  onCancel: () => void;
  onOpenSession: () => void;
}

export function WorkflowRunDetail({
  run,
  presentation,
  deliveryCapabilityEnabled = true,
  busy = false,
  actionError = null,
  openSessionUnavailable = null,
  onBack,
  onRefresh,
  onStartDelivery,
  onCancel,
  onOpenSession,
}: WorkflowRunDetailProps) {
  const managed = run.managedExecution;
  return (
    <ProductPageShell
      title={run.title}
      description={`Managed run · revision ${run.definitionRevision}`}
      maxWidthClassName="max-w-5xl"
      telemetryBlocked
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onRefresh}>Refresh</Button>
          {presentation.canStartDelivery ? (
            <Button
              type="button"
              disabled={busy || !deliveryCapabilityEnabled}
              onClick={onStartDelivery}
            >
              Start delivery
            </Button>
          ) : null}
          {presentation.canCancel ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel run</Button>
          ) : null}
          {presentation.canOpenSession ? (
            <Button type="button" disabled={busy} onClick={onOpenSession}>Open session</Button>
          ) : null}
        </div>
      )}
    >
      <div className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusCard label="Delivery" value={presentation.delivery.label} tone={presentation.delivery.tone} />
          <StatusCard label="Desired state" value={presentation.desired.label} tone={presentation.desired.tone} />
          <StatusCard label="Execution" value={presentation.execution.label} tone={presentation.execution.tone} />
          <StatusCard label="Freshness" value={presentation.freshness.label} tone={presentation.freshness.tone} />
        </section>

        {presentation.notice ? <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning" role="status">{presentation.notice}</p> : null}
        {presentation.canStartDelivery && !deliveryCapabilityEnabled ? (
          <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-muted-foreground" role="status">
            Managed Workflow delivery is not enabled on this server. This prepared run remains available.
          </p>
        ) : null}
        {presentation.failure ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{presentation.failure}</p> : null}
        {actionError ? <p className="text-sm text-destructive" role="alert">{actionError}</p> : null}
        {openSessionUnavailable ? <p className="text-sm text-muted-foreground" role="status">{openSessionUnavailable}</p> : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">Run details</h2>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <Detail label="Created" value={formatDateTime(run.createdAt)} />
            <Detail label="Placement" value={run.placement.kind === "scratch" ? "Scratch workspace" : "Repository worktree"} />
            <Detail label="Run ID" value={run.id} />
            <Detail label="Last observation" value={managed.freshness.latestObservedAt ? formatDateTime(managed.freshness.latestObservedAt) : "No observation yet"} />
          </dl>
        </section>

        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Inputs ({Object.keys(run.arguments).length})
          </summary>
          <dl className="mt-3 space-y-2" data-telemetry-mask>
            {Object.entries(run.arguments).map(([name, value]) => (
              <div key={name} className="flex items-start justify-between gap-4 text-xs">
                <dt className="font-mono text-muted-foreground">{name}</dt>
                <dd className="max-w-[70%] break-words text-right text-foreground">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">Steps</h2>
          {managed.execution?.steps.length ? managed.execution.steps.map((step) => (
            <div key={step.index} className="mt-3 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>Prompt</span>
              <span className="text-muted-foreground">{step.status}</span>
            </div>
          )) : <p className="mt-2 text-xs text-muted-foreground">Waiting for runtime acceptance.</p>}
        </section>
      </div>
    </ProductPageShell>
  );
}

function StatusCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-ui-sm uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-medium ${toneClass(tone)}`}>{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 break-all text-foreground">{value}</dd></div>;
}

function toneClass(tone: string): string {
  if (tone === "danger") return "text-destructive";
  if (tone === "warning") return "text-warning";
  if (tone === "success") return "text-success";
  return "text-foreground";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
