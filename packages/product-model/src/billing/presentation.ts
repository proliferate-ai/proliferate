import type {
  BillingBlockedResource,
  BillingBlockReason,
} from "@proliferate/cloud-sdk";

export type BillingTone = "neutral" | "success" | "info" | "warning" | "destructive";

export type BillingActionIntent =
  | "connect_github"
  | "ensure_account_credits"
  | "start_team"
  | "manage_team_billing"
  | "open_invoice"
  | "open_agent_auth"
  | "none";

export interface BillingBlockPresentation {
  reason: string;
  title: string;
  description: string;
  tone: BillingTone;
  actionIntent: BillingActionIntent;
  blockedResource: Exclude<BillingBlockedResource, null> | null;
}

export const KNOWN_BILLING_BLOCK_REASONS = [
  "compute_credits_exhausted",
  "llm_credits_exhausted",
  "overage_disabled",
  "cap_exhausted",
  "payment_failed",
  "admin_hold",
  "external_billing_hold",
  "subscription_required_for_team",
  "subject_not_allowed_for_cloud",
  "concurrency_limit",
  "agent_gateway_disabled",
  "managed_credit_agent_not_configured",
  "free_credits_github_allocation_unavailable",
] as const satisfies readonly BillingBlockReason[];

export function billingBlockPresentation(
  reason: BillingBlockReason | string | null | undefined,
  blockedResource: BillingBlockedResource = null,
): BillingBlockPresentation {
  const normalizedReason = reason || "unknown";
  switch (normalizedReason) {
    case "compute_credits_exhausted":
      return {
        reason: normalizedReason,
        title: "Cloud credits exhausted",
        description: "The included managed cloud time for this billing period has been used.",
        tone: "warning",
        actionIntent: "start_team",
        blockedResource: "compute",
      };
    case "llm_credits_exhausted":
      return {
        reason: normalizedReason,
        title: "LLM credits exhausted",
        description: "The included managed LLM budget for this billing period has been used.",
        tone: "warning",
        actionIntent: "manage_team_billing",
        blockedResource: "llm",
      };
    case "overage_disabled":
      return {
        reason: normalizedReason,
        title: "Cloud overage is off",
        description: "A Team owner or admin can enable capped overage for continued managed cloud usage.",
        tone: "warning",
        actionIntent: "manage_team_billing",
        blockedResource: "compute",
      };
    case "cap_exhausted":
      return {
        reason: normalizedReason,
        title: "Cloud overage cap reached",
        description: "The Team overage cap has been reached for this billing period.",
        tone: "warning",
        actionIntent: "manage_team_billing",
        blockedResource: "compute",
      };
    case "payment_failed":
      return {
        reason: normalizedReason,
        title: "Payment needs attention",
        description: "Team managed cloud usage is paused until the open invoice is resolved.",
        tone: "destructive",
        actionIntent: "open_invoice",
        blockedResource: "billing",
      };
    case "admin_hold":
      return {
        reason: normalizedReason,
        title: "Billing hold",
        description: "A Team billing hold is preventing new managed cloud launches.",
        tone: "destructive",
        actionIntent: "manage_team_billing",
        blockedResource: "billing",
      };
    case "external_billing_hold":
      return {
        reason: normalizedReason,
        title: "Billing provider hold",
        description: "The billing provider has a hold on this Team subscription.",
        tone: "destructive",
        actionIntent: "manage_team_billing",
        blockedResource: "billing",
      };
    case "subscription_required_for_team":
      return {
        reason: normalizedReason,
        title: "Team subscription required",
        description: "Start a Team plan before launching Team Cloud work.",
        tone: "warning",
        actionIntent: "start_team",
        blockedResource: "billing",
      };
    case "subject_not_allowed_for_cloud":
      return {
        reason: normalizedReason,
        title: "Cloud launch unavailable",
        description: "This account or Team is not allowed to start managed cloud work.",
        tone: "destructive",
        actionIntent: "manage_team_billing",
        blockedResource: "billing",
      };
    case "concurrency_limit":
      return {
        reason: normalizedReason,
        title: "Cloud limit reached",
        description: "Stop an active managed cloud workspace before starting another one.",
        tone: "warning",
        actionIntent: "none",
        blockedResource: "compute",
      };
    case "agent_gateway_disabled":
      return {
        reason: normalizedReason,
        title: "Managed LLM gateway unavailable",
        description: "Managed LLM routing is disabled for this deployment.",
        tone: "warning",
        actionIntent: "open_agent_auth",
        blockedResource: "gateway",
      };
    case "managed_credit_agent_not_configured":
      return {
        reason: normalizedReason,
        title: "Managed LLM agent not ready",
        description: "The selected agent is not configured for managed LLM credits yet.",
        tone: "warning",
        actionIntent: "open_agent_auth",
        blockedResource: "llm",
      };
    case "free_credits_github_allocation_unavailable":
      return {
        reason: normalizedReason,
        title: "GitHub-linked credits unavailable",
        description: "Connect the GitHub identity that owns this account's free credits.",
        tone: "warning",
        actionIntent: "connect_github",
        blockedResource: blockedResource ?? "billing",
      };
    default:
      return {
        reason: normalizedReason,
        title: "Billing check blocked launch",
        description: "Review Account credits or Team billing before starting managed cloud work.",
        tone: "warning",
        actionIntent: "manage_team_billing",
        blockedResource: blockedResource ?? null,
      };
  }
}

export type BillingPlanKey = "free" | "team" | "enterprise";
export type BillingPlanCell = boolean | string;

export interface BillingPlanColumn {
  key: BillingPlanKey;
  name: string;
  tagline: string;
  price: string;
  suffix: string;
  billing: string;
  highlightsLabel: string;
  highlights: string[];
  featured?: boolean;
}

export interface BillingPlanRow {
  label: string;
  pill?: string;
  values: Record<BillingPlanKey, BillingPlanCell>;
}

export interface BillingPlanSection {
  title: string;
  rows: BillingPlanRow[];
}

export const BILLING_PLAN_COLUMNS: BillingPlanColumn[] = [
  {
    key: "free",
    name: "Free",
    tagline: "Account credits and evaluation.",
    price: "$0",
    suffix: "included",
    billing: "No card required",
    highlightsLabel: "Includes",
    highlights: [
      "Account cloud and LLM credits",
      "Desktop, web, and mobile dispatch",
      "Local and SSH workspaces",
      "Personal Cloud targets",
      "Community and docs support",
    ],
  },
  {
    key: "team",
    name: "Team",
    tagline: "Shared managed cloud for teams.",
    price: "Configured",
    suffix: "per seat",
    billing: "Managed through Stripe",
    featured: true,
    highlightsLabel: "Everything in Free, plus",
    highlights: [
      "Managed cloud hours per seat",
      "Shared cloud sessions, Slack, and automations",
      "Team environments and admin controls",
      "Shared plugins, MCPs, skills, and agent auth",
      "Capped managed cloud overage",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    tagline: "Private deployment or procurement.",
    price: "Custom",
    suffix: "contract",
    billing: "Annual agreement",
    highlightsLabel: "Everything in Team, plus",
    highlights: [
      "Self-hosted or private deployment",
      "SSO, audit logs, and retention controls",
      "BYOK gateway readiness",
      "Custom usage limits and procurement",
      "Dedicated implementation support",
    ],
  },
];

export const BILLING_PLAN_SECTIONS: BillingPlanSection[] = [
  {
    title: "Usage and limits",
    rows: [
      { label: "Team members", values: { free: "1", team: "Unlimited", enterprise: "Unlimited" } },
      { label: "Account Cloud target", values: { free: "Included", team: "Included", enterprise: "Included" } },
      { label: "Team Cloud target", values: { free: false, team: "Included", enterprise: "Custom" } },
      { label: "Included managed cloud", values: { free: "Account credits", team: "Per-seat allowance", enterprise: "Custom" } },
      { label: "Cloud environments", values: { free: "Starter", team: "Team-managed", enterprise: "Custom" } },
      { label: "Managed cloud overage", values: { free: false, team: "Capped", enterprise: "Custom" } },
      { label: "Managed LLM credits", values: { free: "Account credits", team: "Included", enterprise: "Custom / BYOK" } },
      { label: "SSH targets", values: { free: "1", team: "Unlimited", enterprise: "Unlimited" } },
    ],
  },
  {
    title: "Team work",
    rows: [
      { label: "Desktop app", values: { free: true, team: true, enterprise: true } },
      { label: "Web and mobile dispatch", values: { free: true, team: true, enterprise: true } },
      { label: "Local workspaces and worktrees", values: { free: true, team: true, enterprise: true } },
      { label: "Personal Cloud workspaces", values: { free: true, team: true, enterprise: true } },
      { label: "Shared cloud workspaces", values: { free: false, team: true, enterprise: true } },
      { label: "Slack integration", values: { free: false, team: true, enterprise: true } },
      { label: "Automations", pill: "Beta", values: { free: "Definitions", team: "Cloud runs", enterprise: "Cloud runs" } },
      { label: "Plugins, MCPs, skills", values: { free: "Account", team: "Shared across Team", enterprise: "Shared deployment" } },
    ],
  },
  {
    title: "Auth and security",
    rows: [
      { label: "Synced native agent auth", values: { free: true, team: true, enterprise: true } },
      { label: "Shared synced auth", pill: "Owner consent", values: { free: false, team: true, enterprise: true } },
      { label: "BYOK gateway", values: { free: false, team: false, enterprise: true } },
      { label: "Custom model routing", values: { free: false, team: false, enterprise: true } },
      { label: "SSO / SAML", values: { free: false, team: false, enterprise: true } },
      { label: "Audit log", values: { free: false, team: false, enterprise: true } },
      { label: "Self-hosted deployment", values: { free: false, team: false, enterprise: true } },
    ],
  },
  {
    title: "Support",
    rows: [
      { label: "Community and docs", values: { free: true, team: true, enterprise: true } },
      { label: "Email support", values: { free: false, team: true, enterprise: true } },
      { label: "Dedicated success", values: { free: false, team: false, enterprise: true } },
    ],
  },
];

export const FORBIDDEN_BILLING_TERMS = [
  "personal billing",
  "personal paid plan",
  "personal overage",
  "refill",
  "org billing",
  "customer-facing Pro",
] as const;

const FORBIDDEN_TERM_PATTERNS: readonly {
  term: typeof FORBIDDEN_BILLING_TERMS[number];
  pattern: RegExp;
}[] = [
  { term: "personal billing", pattern: /\bpersonal\s+billing\b/iu },
  { term: "personal paid plan", pattern: /\bpersonal\s+paid\s+plan\b/iu },
  { term: "personal overage", pattern: /\bpersonal\s+overage\b/iu },
  { term: "refill", pattern: /\brefill\b/iu },
  { term: "org billing", pattern: /\borg\s+billing\b/iu },
  { term: "customer-facing Pro", pattern: /\bPro\b/u },
];

export function findForbiddenBillingTerms(text: string): string[] {
  return FORBIDDEN_TERM_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ term }) => term);
}

export function billingPlanCopyText(): string {
  const values: string[] = [];
  for (const column of BILLING_PLAN_COLUMNS) {
    values.push(
      column.name,
      column.tagline,
      column.price,
      column.suffix,
      column.billing,
      column.highlightsLabel,
      ...column.highlights,
    );
  }
  for (const section of BILLING_PLAN_SECTIONS) {
    values.push(section.title);
    for (const row of section.rows) {
      values.push(row.label);
      if (row.pill) {
        values.push(row.pill);
      }
      for (const value of Object.values(row.values)) {
        if (typeof value === "string") {
          values.push(value);
        }
      }
    }
  }
  return values.join("\n");
}
