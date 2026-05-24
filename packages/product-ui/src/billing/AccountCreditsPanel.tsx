import { Cloud, Cpu } from "lucide-react";

import type { AccountCreditsPanelView } from "@proliferate/product-model/billing/model";

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

export interface AccountCreditsPanelProps {
  view: AccountCreditsPanelView | null;
  loading?: boolean;
  error?: string | null;
  actionError?: string | null;
  retryAction?: BillingPanelActionView;
  ensureAction?: BillingPanelActionView;
  connectGitHubAction?: BillingPanelActionView;
  startTeamAction?: BillingPanelActionView;
}

export function AccountCreditsPanel({
  view,
  loading = false,
  error = null,
  actionError = null,
  retryAction,
  ensureAction,
  connectGitHubAction,
  startTeamAction,
}: AccountCreditsPanelProps) {
  if (loading && !view) {
    return (
      <SettingsCard>
        <BillingLoadingRow label="Loading Account credits..." />
      </SettingsCard>
    );
  }

  if (error) {
    return (
      <SettingsCard>
        <SettingsCardRow label="Account credits" description={error}>
          {retryAction ? <BillingPanelButton action={retryAction} /> : null}
        </SettingsCardRow>
      </SettingsCard>
    );
  }

  if (!view) {
    return (
      <SettingsCard>
        <SettingsCardRow
          label="Account credits"
          description="Account credit details are not available."
        />
      </SettingsCard>
    );
  }

  const primaryAction = actionForIntent(view.primaryActionIntent, {
    ensureAction,
    connectGitHubAction,
    startTeamAction,
  });

  return (
    <SettingsCard>
      <div className="space-y-5 p-4">
        <BillingPanelHeader
          icon={<Cloud className="size-4" />}
          title={view.title}
          description={view.description}
          status={view.status}
          actions={primaryAction ? <BillingPanelButton action={primaryAction} variant="primary" /> : null}
        />

        {actionError ? (
          <SettingsCardRow label="Account credits action failed" description={actionError} />
        ) : null}

        {view.notices.map((notice) => (
          <BillingNotice
            key={notice.id}
            notice={notice}
            action={actionForIntent(notice.actionIntent, {
              ensureAction,
              connectGitHubAction,
              startTeamAction,
            })}
          />
        ))}

        <div className="border-t border-border-light pt-4">
          <BillingMetricGrid metrics={view.metrics} />
        </div>

        <div className="flex flex-col gap-3 border-t border-border-light pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Cpu className="size-4 text-muted-foreground" />
              <span>Managed LLM credits</span>
              <BillingStatusBadge status={view.managedLlm.status} />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {view.managedLlm.budgetLabel} - {view.managedLlm.detail}
            </p>
            {view.managedLlm.readyModelsLabel ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {view.managedLlm.readyModelsLabel}
              </p>
            ) : null}
            {view.managedLlm.errorLabel ? (
              <p className="text-xs leading-5 text-destructive">
                {view.managedLlm.errorLabel}
              </p>
            ) : null}
          </div>
          {connectGitHubAction && view.primaryActionIntent === "connect_github" ? (
            <BillingPanelButton action={connectGitHubAction} variant="secondary" />
          ) : null}
        </div>

        {startTeamAction ? (
          <div className="flex flex-col gap-3 border-t border-border-light pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-foreground">Need shared usage?</div>
              <p className="text-xs leading-5 text-muted-foreground">
                Start a Team plan for seats, shared cloud, and managed Team credits.
              </p>
            </div>
            <BillingPanelButton action={startTeamAction} variant="secondary" />
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}

function actionForIntent(
  intent: AccountCreditsPanelView["primaryActionIntent"],
  actions: {
    ensureAction?: BillingPanelActionView;
    connectGitHubAction?: BillingPanelActionView;
    startTeamAction?: BillingPanelActionView;
  },
): BillingPanelActionView | undefined {
  if (intent === "connect_github") {
    return actions.connectGitHubAction;
  }
  if (intent === "start_team") {
    return actions.startTeamAction;
  }
  if (intent === "ensure_account_credits") {
    return actions.ensureAction;
  }
  return undefined;
}
