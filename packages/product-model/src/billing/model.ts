import type {
  AccountCreditsOverview,
  BillingEventSummary,
  TeamBillingEnvelope,
  TeamBillingOverview,
} from "@proliferate/cloud-sdk";

import {
  billingBlockPresentation,
  type BillingActionIntent,
  type BillingTone,
} from "./presentation";

export interface BillingStatusView {
  label: string;
  tone: BillingTone;
}

export interface BillingMetricView {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone?: BillingTone;
}

export interface BillingNoticeView {
  id: string;
  tone: Exclude<BillingTone, "success" | "neutral">;
  title: string;
  description: string;
  actionIntent: BillingActionIntent;
}

export interface ManagedLlmCreditsView {
  status: BillingStatusView;
  budgetLabel: string;
  detail: string;
  readyModelsLabel: string | null;
  errorLabel: string | null;
}

export interface GatewayReadinessView {
  status: BillingStatusView;
  description: string;
  actionIntent: BillingActionIntent;
}

export interface TeamOverageView {
  enabled: boolean;
  status: BillingStatusView;
  description: string;
  capLabel: string;
  usedLabel: string;
}

export interface BillingEventView {
  id: string;
  kind: string;
  status: BillingStatusView;
  occurredAtLabel: string;
  summary: string;
}

export interface AccountCreditsPanelView {
  title: string;
  description: string;
  status: BillingStatusView;
  metrics: BillingMetricView[];
  notices: BillingNoticeView[];
  managedLlm: ManagedLlmCreditsView;
  primaryActionIntent: BillingActionIntent;
  primaryActionLabel: string;
}

export interface TeamBillingPanelView {
  title: string;
  description: string;
  hasTeam: boolean;
  canCreateTeam: boolean;
  canManageBilling: boolean;
  pendingCheckout: {
    teamName: string;
    checkoutUrl: string | null;
    expiresAt: string | null;
  } | null;
  status: BillingStatusView;
  metrics: BillingMetricView[];
  notices: BillingNoticeView[];
  managedLlm: ManagedLlmCreditsView | null;
  gatewayReadiness: GatewayReadinessView;
  overage: TeamOverageView | null;
  events: BillingEventView[];
}

export function buildAccountCreditsPanelView(
  credits: AccountCreditsOverview | null | undefined,
): AccountCreditsPanelView | null {
  if (!credits) {
    return null;
  }

  const block = credits.startBlocked
    ? billingBlockPresentation(credits.startBlockReason, credits.blockedResource ?? null)
    : null;
  const notices: BillingNoticeView[] = [];

  if (credits.githubRequired || credits.freeAllocationStatus === "requires_github") {
    notices.push({
      id: "github-required",
      tone: "warning",
      title: "GitHub required",
      description: "Connect GitHub to claim account cloud and LLM credits.",
      actionIntent: "connect_github",
    });
  }

  if (block) {
    notices.push({
      id: `block-${block.reason}`,
      tone: block.tone === "destructive" ? "destructive" : "warning",
      title: block.title,
      description: block.description,
      actionIntent: block.reason === "llm_credits_exhausted"
        ? "start_team"
        : block.actionIntent,
    });
  }

  const status = block
    ? { label: "Blocked", tone: block.tone }
    : credits.freeAllocationStatus === "exhausted"
      ? { label: "Exhausted", tone: "warning" as const }
      : credits.freeAllocationStatus === "disabled"
        ? { label: "Disabled", tone: "neutral" as const }
        : credits.githubRequired
          ? { label: "Action needed", tone: "warning" as const }
          : { label: "Available", tone: "success" as const };

  return {
    title: "Account credits",
    description: "Free cloud and LLM credits included with your account.",
    status,
    metrics: [
      {
        id: "free-cloud",
        label: "Cloud credits",
        value: formatHours(credits.freeCloud.remainingHours),
        detail: `${formatHours(credits.freeCloud.usedHours)} used${formatHoursTotal(
          credits.freeCloud.includedHours,
        )}`,
      },
      {
        id: "free-llm",
        label: "LLM credits",
        value: credits.freeLlm.enabled ? formatUsdBudget(credits.freeLlm.includedBudgetUsd) : "Off",
        detail: credits.freeLlm.enabled
          ? managedLlmStatusLabel(credits.freeLlm.status)
          : "Managed LLM credits are not enabled.",
      },
      {
        id: "launch-readiness",
        label: "Launch readiness",
        value: block ? block.title : "Ready",
        detail: block ? block.description : "Account credits can be used for Personal Cloud work.",
        tone: block?.tone,
      },
    ],
    notices,
    managedLlm: buildManagedLlmCreditsView(credits.freeLlm),
    primaryActionIntent: credits.githubRequired ? "connect_github" : "ensure_account_credits",
    primaryActionLabel: credits.githubRequired ? "Connect GitHub" : "Check credits",
  };
}

export function buildTeamBillingPanelView(
  envelope: TeamBillingEnvelope | null | undefined,
  events: readonly BillingEventSummary[] = [],
): TeamBillingPanelView | null {
  if (!envelope) {
    return null;
  }

  if (!envelope.team) {
    const canCreateTeam = envelope.canCreateTeam && !envelope.pendingCheckout;
    return {
      title: "Team billing",
      description: "Start a Team plan to add seats, shared cloud, automations, and admin controls.",
      hasTeam: false,
      canCreateTeam,
      canManageBilling: false,
      pendingCheckout: envelope.pendingCheckout
        ? {
            teamName: envelope.pendingCheckout.teamName,
            checkoutUrl: envelope.pendingCheckout.checkoutUrl ?? null,
            expiresAt: envelope.pendingCheckout.expiresAt ?? null,
          }
        : null,
      status: envelope.pendingCheckout
        ? { label: "Checkout pending", tone: "warning" }
        : { label: "Not started", tone: "neutral" },
      metrics: [],
      notices: [],
      managedLlm: null,
      gatewayReadiness: {
        status: { label: "Team required", tone: "neutral" },
        description: "Team gateway readiness appears after a Team subscription exists.",
        actionIntent: "start_team",
      },
      overage: null,
      events: [],
    };
  }

  const team = envelope.team;
  const block = team.startBlocked
    ? billingBlockPresentation(team.startBlockReason, team.blockedResource ?? null)
    : null;
  const notices = buildTeamNotices(team, block);
  const managedLlm = buildManagedLlmCreditsView(team.managedLlm);

  return {
    title: `${team.name} billing`,
    description: "Team billing covers seats, shared cloud, managed LLM credits, and capped overage.",
    hasTeam: true,
    canCreateTeam: envelope.canCreateTeam,
    canManageBilling: team.canManageBilling,
    pendingCheckout: envelope.pendingCheckout
      ? {
          teamName: envelope.pendingCheckout.teamName,
          checkoutUrl: envelope.pendingCheckout.checkoutUrl ?? null,
          expiresAt: envelope.pendingCheckout.expiresAt ?? null,
        }
      : null,
    status: teamStatus(team, block?.tone),
    metrics: [
      {
        id: "seats",
        label: "Seats",
        value: formatLimit(team.activeMemberCount, team.seatQuantity),
        detail: `${roleLabel(team.role)} access`,
      },
      {
        id: "managed-cloud",
        label: "Managed cloud",
        value: formatHours(team.managedCloud.remainingHours),
        detail: `${formatHours(team.managedCloud.usedHours)} used${formatHoursTotal(
          team.managedCloud.includedHours,
        )}`,
      },
      {
        id: "payment",
        label: "Payment",
        value: team.paymentHealthy ? "Healthy" : "Needs attention",
        detail: subscriptionStatusLabel(team.subscriptionStatus),
        tone: team.paymentHealthy ? "success" : "destructive",
      },
    ],
    notices,
    managedLlm,
    gatewayReadiness: gatewayReadinessForManagedLlm(managedLlm),
    overage: buildTeamOverageView(team),
    events: team.canManageBilling ? buildBillingEventViews(events) : [],
  };
}

export function buildBillingEventViews(
  events: readonly BillingEventSummary[],
): BillingEventView[] {
  return events.map((event) => ({
    id: event.id,
    kind: event.kind,
    status: {
      label: eventSeverityLabel(event.severity),
      tone: eventSeverityTone(event.severity),
    },
    occurredAtLabel: stableDateLabel(event.occurredAt),
    summary: event.summary,
  }));
}

function buildTeamNotices(
  team: TeamBillingOverview,
  block: ReturnType<typeof billingBlockPresentation> | null,
): BillingNoticeView[] {
  const notices: BillingNoticeView[] = [];
  if (!team.canManageBilling) {
    notices.push({
      id: "readonly-member",
      tone: "info",
      title: "Read-only Team billing",
      description: "Team billing is managed by owners and admins.",
      actionIntent: "none",
    });
  }
  if (!team.paymentHealthy) {
    notices.push({
      id: "payment-attention",
      tone: "destructive",
      title: "Payment needs attention",
      description: "Team managed cloud usage may be paused until the open invoice is resolved.",
      actionIntent: "open_invoice",
    });
  }
  if (block) {
    notices.push({
      id: `block-${block.reason}`,
      tone: block.tone === "destructive" ? "destructive" : "warning",
      title: block.title,
      description: block.description,
      actionIntent: block.actionIntent,
    });
  }
  return notices;
}

function buildManagedLlmCreditsView(input: {
  enabled?: boolean;
  status: string;
  includedBudgetUsd: string | null;
  readyAgentModels?: readonly { agentKind: string; modelId: string }[];
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}): ManagedLlmCreditsView {
  const enabled = input.enabled ?? input.status !== "disabled";
  const readyModels = input.readyAgentModels ?? [];
  const status = managedLlmStatus(input.status, enabled);
  return {
    status,
    budgetLabel: enabled ? formatUsdBudget(input.includedBudgetUsd) : "Off",
    detail: enabled
      ? managedLlmStatusLabel(input.status)
      : "Managed LLM credits are disabled for this deployment.",
    readyModelsLabel: readyModels.length > 0
      ? readyModels.map((model) => `${model.agentKind}: ${model.modelId}`).join(", ")
      : null,
    errorLabel: input.lastErrorMessage ?? input.lastErrorCode ?? null,
  };
}

function buildTeamOverageView(team: TeamBillingOverview): TeamOverageView {
  return {
    enabled: team.managedCloud.overageEnabled,
    status: {
      label: team.managedCloud.overageEnabled ? "On" : "Off",
      tone: team.managedCloud.overageEnabled ? "success" : "neutral",
    },
    description: "Capped Team managed cloud overage.",
    capLabel: formatCents(team.managedCloud.overageCapCents),
    usedLabel: formatCents(team.managedCloud.overageUsedCents),
  };
}

function gatewayReadinessForManagedLlm(
  managedLlm: ManagedLlmCreditsView,
): GatewayReadinessView {
  if (managedLlm.status.tone === "success") {
    return {
      status: { label: "Ready", tone: "success" },
      description: "Managed LLM credits are ready. BYOK stays gated until route-isolation proof passes.",
      actionIntent: "none",
    };
  }
  if (managedLlm.status.tone === "destructive") {
    return {
      status: { label: "Needs attention", tone: "destructive" },
      description: "Managed LLM sync needs attention. BYOK remains unavailable until gateway readiness passes.",
      actionIntent: "open_agent_auth",
    };
  }
  return {
    status: { label: "Limited", tone: "warning" },
    description: "Managed LLM gateway readiness is not fully available. BYOK setup remains disabled.",
    actionIntent: "open_agent_auth",
  };
}

function teamStatus(
  team: TeamBillingOverview,
  blockTone: BillingTone | undefined,
): BillingStatusView {
  if (team.startBlocked) {
    return { label: "Blocked", tone: blockTone ?? "warning" };
  }
  if (!team.paymentHealthy) {
    return { label: "Payment attention", tone: "destructive" };
  }
  if (team.subscriptionStatus === "active" || team.subscriptionStatus === "trialing") {
    return { label: "Active", tone: "success" };
  }
  if (team.subscriptionStatus === "past_due" || team.subscriptionStatus === "unpaid") {
    return { label: "Past due", tone: "destructive" };
  }
  if (team.subscriptionStatus) {
    return { label: subscriptionStatusLabel(team.subscriptionStatus), tone: "warning" };
  }
  return { label: "Team", tone: "info" };
}

function managedLlmStatus(status: string, enabled: boolean): BillingStatusView {
  if (!enabled || status === "disabled" || status === "not_configured") {
    return { label: "Off", tone: "neutral" };
  }
  if (status === "ready" || status === "active" || status === "synced") {
    return { label: "Ready", tone: "success" };
  }
  if (status === "exhausted") {
    return { label: "Exhausted", tone: "warning" };
  }
  if (status === "sync_failed" || status === "failed") {
    return { label: "Sync failed", tone: "destructive" };
  }
  return { label: statusLabel(status), tone: "warning" };
}

function managedLlmStatusLabel(status: string): string {
  if (status === "ready" || status === "active" || status === "synced") {
    return "Ready for managed LLM launches";
  }
  if (status === "exhausted") {
    return "Budget exhausted for this period";
  }
  if (status === "disabled" || status === "not_configured") {
    return "Not configured";
  }
  if (status === "sync_failed" || status === "failed") {
    return "Sync needs attention";
  }
  return statusLabel(status);
}

function eventSeverityTone(severity: string): BillingTone {
  if (severity === "success" || severity === "info") {
    return severity;
  }
  if (severity === "error") {
    return "destructive";
  }
  return "warning";
}

function eventSeverityLabel(severity: string): string {
  return severity === "error" ? "Error" : statusLabel(severity);
}

function subscriptionStatusLabel(status: string | null): string {
  return status ? statusLabel(status) : "Subscription state pending";
}

function roleLabel(role: string | null): string {
  return role ? statusLabel(role) : "Team";
}

function statusLabel(value: string): string {
  return value
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unlimited";
  }
  return `${formatNumber(value)}h`;
}

function formatHoursTotal(total: number | null | undefined): string {
  return total === null || total === undefined ? "" : ` of ${formatHours(total)}`;
}

function formatLimit(value: number | null | undefined, limit: number | null | undefined): string {
  const current = value === null || value === undefined ? "0" : value.toLocaleString();
  return limit === null || limit === undefined ? current : `${current} / ${limit.toLocaleString()}`;
}

function formatUsdBudget(value: string | null | undefined): string {
  if (!value) {
    return "Included";
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `$${formatNumber(parsed)}` : `$${value}`;
}

function formatCents(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Not set";
  }
  return `$${formatNumber(value / 100)}`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function stableDateLabel(value: string): string {
  const [date] = value.split("T");
  return date || value;
}
