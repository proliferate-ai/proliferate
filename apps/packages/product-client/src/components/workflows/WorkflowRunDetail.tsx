import { useState } from "react";

import type {
  WorkflowRun,
  WorkflowRunPresentation,
  WorkflowRunTone,
} from "#product/domain/workflows/run-presentation";
import { workflowRunStatusDotTone } from "#product/components/workflows/workflow-run-status-dot";
import { Button } from "#product/primitives/Button";
import { StatusDot } from "#product/primitives/StatusDot";
import { Card } from "#product/primitives/patterns/Card";
import { Disclosure } from "#product/primitives/patterns/Disclosure";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { ProductPageShell } from "#product/primitives/patterns/ProductPageShell";
import { RosterRow } from "#product/primitives/patterns/RosterRow";

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
  const [inputsOpen, setInputsOpen] = useState(false);
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

        {presentation.notice ? <NoticeBanner tone="warning">{presentation.notice}</NoticeBanner> : null}
        {presentation.canStartDelivery && !deliveryCapabilityEnabled ? (
          <NoticeBanner tone="neutral">
            Managed Workflow delivery is not enabled on this server. This prepared run remains available.
          </NoticeBanner>
        ) : null}
        {presentation.failure ? <NoticeBanner tone="destructive">{presentation.failure}</NoticeBanner> : null}
        {actionError ? <p className="text-ui text-destructive" role="alert">{actionError}</p> : null}
        {openSessionUnavailable ? <p className="text-ui text-muted-foreground" role="status">{openSessionUnavailable}</p> : null}

        <Card
          as="section"
          surface="opaque"
          header={<h2 className="px-4 py-3 text-heading font-medium text-foreground">Run details</h2>}
        >
          <dl className="grid gap-3 p-4 text-ui-sm sm:grid-cols-2">
            <Detail label="Created" value={formatDateTime(run.createdAt)} />
            <Detail label="Placement" value={run.placement.kind === "scratch" ? "Scratch workspace" : "Repository worktree"} />
            <Detail label="Run ID" value={run.id} />
            <Detail label="Last observation" value={managed.freshness.latestObservedAt ? formatDateTime(managed.freshness.latestObservedAt) : "No observation yet"} />
          </dl>
        </Card>

        <Card as="section" surface="opaque">
          <div className="p-4">
            <Disclosure
              open={inputsOpen}
              onOpenChange={setInputsOpen}
              title={`Inputs (${Object.keys(run.arguments).length})`}
              chevronSide="trailing"
            >
              <dl className="space-y-2 pt-2" data-telemetry-mask>
                {Object.entries(run.arguments).map(([name, value]) => (
                  <div key={name} className="flex items-start justify-between gap-4 text-ui-sm">
                    <dt className="font-mono text-muted-foreground">{name}</dt>
                    {/* C4: mirrors the two-column key/value layout above it, keeps values from crowding out long keys. */}
                    <dd className="max-w-[70%] break-words text-right text-foreground">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
          </div>
        </Card>

        <Card
          as="section"
          surface="opaque"
          header={<h2 className="px-4 py-3 text-heading font-medium text-foreground">Steps</h2>}
        >
          {managed.execution?.steps.length ? (
            <div className="flex flex-col gap-0.5 p-2">
              {managed.execution.steps.map((step) => (
                <RosterRow key={step.index} density="comfortable" title="Prompt" trailing={step.status} />
              ))}
            </div>
          ) : (
            <p className="p-4 text-ui-sm text-muted-foreground">Waiting for runtime acceptance.</p>
          )}
        </Card>
      </div>
    </ProductPageShell>
  );
}

function StatusCard({ label, value, tone }: { label: string; value: string; tone: WorkflowRunTone }) {
  return (
    <Card surface="opaque" className="p-3">
      <p className="text-ui-sm uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-body-emphasis font-medium text-foreground">
        <StatusDot tone={workflowRunStatusDotTone(tone)} />
        {value}
      </p>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 break-all text-foreground">{value}</dd></div>;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
