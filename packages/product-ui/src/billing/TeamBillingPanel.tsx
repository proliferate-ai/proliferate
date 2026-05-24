import { Building2, Cpu, Gauge, ReceiptText, ShieldCheck } from "lucide-react";

import type {
  BillingNoticeView,
  ManagedLlmCreditsView,
  TeamBillingPanelView,
  TeamOverageView,
} from "@proliferate/product-model/billing/model";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { SettingsCard } from "../settings/SettingsCard";
import { SettingsCardRow } from "../settings/SettingsCardRow";
import {
  BillingLoadingRow,
  BillingMetricGrid,
  BillingNotice,
  BillingPanelButton,
  BillingPanelHeader,
  BillingStatusBadge,
  type BillingPanelActionView,
} from "./BillingPanelParts";

export interface TeamBillingPanelProps {
  view: TeamBillingPanelView | null;
  loading?: boolean;
  error?: string | null;
  actionError?: string | null;
  retryAction?: BillingPanelActionView;
  startTeamAction?: BillingPanelActionView;
  continueCheckoutAction?: BillingPanelActionView;
  manageBillingAction?: BillingPanelActionView;
  toggleOverageAction?: BillingPanelActionView;
  invoiceAction?: BillingPanelActionView;
  agentAuthAction?: BillingPanelActionView;
}

export function TeamBillingPanel({
  view,
  loading = false,
  error = null,
  actionError = null,
  retryAction,
  startTeamAction,
  continueCheckoutAction,
  manageBillingAction,
  toggleOverageAction,
  invoiceAction,
  agentAuthAction,
}: TeamBillingPanelProps) {
  if (loading && !view) {
    return (
      <SettingsCard>
        <BillingLoadingRow label="Loading Team billing..." />
      </SettingsCard>
    );
  }

  if (error) {
    return (
      <SettingsCard>
        <SettingsCardRow label="Team billing" description={error}>
          {retryAction ? <BillingPanelButton action={retryAction} /> : null}
        </SettingsCardRow>
      </SettingsCard>
    );
  }

  if (!view) {
    return (
      <SettingsCard>
        <SettingsCardRow label="Team billing" description="Team billing details are not available." />
      </SettingsCard>
    );
  }

  if (!view.hasTeam) {
    return (
      <SettingsCard>
        {view.pendingCheckout ? (
          <PendingTeamCheckoutPanel
            view={view}
            continueCheckoutAction={continueCheckoutAction}
          />
        ) : (
          <TeamCheckoutPanel view={view} startTeamAction={startTeamAction} />
        )}
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <div className="space-y-5 p-4">
        <BillingPanelHeader
          icon={<Building2 className="size-4" />}
          title={view.title}
          description={view.description}
          status={view.status}
          actions={
            view.canManageBilling && manageBillingAction ? (
              <BillingPanelButton action={manageBillingAction} variant="primary" />
            ) : null
          }
        />

        {actionError ? (
          <SettingsCardRow label="Team billing action failed" description={actionError} />
        ) : null}

        <TeamBillingStatusBanner
          notices={view.notices}
          manageBillingAction={manageBillingAction}
          invoiceAction={invoiceAction}
          agentAuthAction={agentAuthAction}
        />

        <div className="border-t border-border-light pt-4">
          <BillingMetricGrid metrics={view.metrics} />
        </div>

        {view.managedLlm ? (
          <ManagedLlmCreditsSummary
            view={view.managedLlm}
            agentAuthAction={agentAuthAction}
          />
        ) : null}

        <GatewayReadinessSummary
          view={view.gatewayReadiness}
          agentAuthAction={agentAuthAction}
        />

        {view.overage ? (
          <TeamOverageControl
            view={view.overage}
            action={view.canManageBilling ? toggleOverageAction : undefined}
          />
        ) : null}

        <BillingEventsList events={view.events} />
      </div>
    </SettingsCard>
  );
}

export function TeamCheckoutPanel({
  view,
  startTeamAction,
}: {
  view: TeamBillingPanelView;
  startTeamAction?: BillingPanelActionView;
}) {
  return (
    <div className="space-y-4 p-4">
      <BillingPanelHeader
        icon={<Building2 className="size-4" />}
        title={view.title}
        description={view.description}
        status={view.status}
        actions={startTeamAction ? <BillingPanelButton action={startTeamAction} variant="primary" /> : null}
      />
    </div>
  );
}

export function PendingTeamCheckoutPanel({
  view,
  continueCheckoutAction,
}: {
  view: TeamBillingPanelView;
  continueCheckoutAction?: BillingPanelActionView;
}) {
  return (
    <div className="space-y-4 p-4">
      <BillingPanelHeader
        icon={<ReceiptText className="size-4" />}
        title="Team checkout pending"
        description={`${view.pendingCheckout?.teamName ?? "Your Team"} is waiting for Stripe checkout to finish.`}
        status={view.status}
        actions={
          continueCheckoutAction ? (
            <BillingPanelButton action={continueCheckoutAction} variant="primary" />
          ) : null
        }
      />
      {view.pendingCheckout?.expiresAt ? (
        <p className="text-xs text-muted-foreground">
          Checkout expires {view.pendingCheckout.expiresAt.slice(0, 10)}.
        </p>
      ) : null}
    </div>
  );
}

export function TeamBillingStatusBanner({
  notices,
  manageBillingAction,
  invoiceAction,
  agentAuthAction,
}: {
  notices: readonly BillingNoticeView[];
  manageBillingAction?: BillingPanelActionView;
  invoiceAction?: BillingPanelActionView;
  agentAuthAction?: BillingPanelActionView;
}) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {notices.map((notice) => (
        <BillingNotice
          key={notice.id}
          notice={notice}
          action={actionForNotice(notice, {
            manageBillingAction,
            invoiceAction,
            agentAuthAction,
          })}
        />
      ))}
    </div>
  );
}

export function TeamOverageControl({
  view,
  action,
}: {
  view: TeamOverageView;
  action?: BillingPanelActionView;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border-light pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Gauge className="size-4 text-muted-foreground" />
          <span>Managed cloud overage</span>
          <BillingStatusBadge status={view.status} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {view.description} {view.usedLabel} used of {view.capLabel}.
        </p>
      </div>
      {action ? <BillingPanelButton action={action} /> : null}
    </div>
  );
}

export function ManagedLlmCreditsSummary({
  view,
  agentAuthAction,
}: {
  view: ManagedLlmCreditsView;
  agentAuthAction?: BillingPanelActionView;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border-light pt-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Cpu className="size-4 text-muted-foreground" />
          <span>Managed LLM credits</span>
          <BillingStatusBadge status={view.status} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {view.budgetLabel} - {view.detail}
        </p>
        {view.readyModelsLabel ? (
          <p className="text-xs leading-5 text-muted-foreground">{view.readyModelsLabel}</p>
        ) : null}
        {view.errorLabel ? (
          <p className="text-xs leading-5 text-destructive">{view.errorLabel}</p>
        ) : null}
      </div>
      {agentAuthAction && view.status.tone !== "success" ? (
        <BillingPanelButton action={agentAuthAction} />
      ) : null}
    </div>
  );
}

function GatewayReadinessSummary({
  view,
  agentAuthAction,
}: {
  view: TeamBillingPanelView["gatewayReadiness"];
  agentAuthAction?: BillingPanelActionView;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border-light pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <span>Gateway readiness</span>
          <BillingStatusBadge status={view.status} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{view.description}</p>
      </div>
      {agentAuthAction && view.actionIntent === "open_agent_auth" ? (
        <BillingPanelButton action={agentAuthAction} />
      ) : null}
    </div>
  );
}

export function BillingEventsList({
  events,
}: {
  events: readonly TeamBillingPanelView["events"][number][];
}) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 border-t border-border-light pt-4">
      <div className="text-sm font-medium text-foreground">Recent billing events</div>
      <div className="overflow-hidden rounded-lg border border-border-light">
        {events.map((event) => (
          <div
            key={event.id}
            className="grid gap-2 border-b border-border-light px-3 py-2.5 text-sm last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
          >
            <div className="text-xs text-muted-foreground">{event.occurredAtLabel}</div>
            <div className="min-w-0 truncate text-foreground">{event.summary}</div>
            <Badge tone={event.status.tone}>{event.status.label}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function actionForNotice(
  notice: BillingNoticeView,
  actions: {
    manageBillingAction?: BillingPanelActionView;
    invoiceAction?: BillingPanelActionView;
    agentAuthAction?: BillingPanelActionView;
  },
): BillingPanelActionView | undefined {
  if (notice.actionIntent === "open_invoice") {
    return actions.invoiceAction;
  }
  if (notice.actionIntent === "open_agent_auth") {
    return actions.agentAuthAction;
  }
  if (notice.actionIntent === "manage_team_billing") {
    return actions.manageBillingAction;
  }
  return undefined;
}
