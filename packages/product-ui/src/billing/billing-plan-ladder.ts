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
    tagline: "Personal cloud work.",
    price: "$0",
    suffix: "forever",
    billing: "Free for everyone",
    highlightsLabel: "Includes",
    highlights: [
      "Personal cloud starter usage",
      "Desktop, web, and mobile dispatch",
      "Personal plugins, MCPs, and skills",
      "Local and SSH workspaces",
      "Community and docs support",
    ],
  },
  {
    key: "team",
    name: "Team",
    tagline: "Shared cloud for teams.",
    price: "$20",
    suffix: "per user / month",
    billing: "Billed monthly",
    featured: true,
    highlightsLabel: "Everything in Free, plus",
    highlights: [
      "20 managed-cloud hours per user",
      "4 cloud repo environments per user",
      "2 active cloud environments per user",
      "Shared cloud, Slack, and team automations",
      "Shared plugins, MCPs, skills, and agent auth",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    tagline: "Self-hosted or procured.",
    price: "Custom",
    suffix: "contact sales",
    billing: "Annual contract",
    highlightsLabel: "Everything in Team, plus",
    highlights: [
      "Self-hosted or private deployment",
      "SSO, audit logs, and retention controls",
      "BYOK gateway and custom models",
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
      { label: "Personal cloud sandbox", values: { free: "1", team: "1 per user", enterprise: "1 per user" } },
      { label: "Shared cloud sandbox", values: { free: false, team: "1 per org", enterprise: "Custom" } },
      { label: "Included managed cloud", values: { free: "Starter usage", team: "20 hr / user / month", enterprise: "Custom" } },
      { label: "Active cloud environments", values: { free: "1", team: "2 / user", enterprise: "Custom" } },
      { label: "Cloud repo environments", values: { free: "1", team: "4 / user", enterprise: "Custom" } },
      { label: "Managed cloud overage", values: { free: false, team: "$2 / hr, capped", enterprise: "Custom" } },
      { label: "Managed LLM credits", values: { free: "Starter credits", team: "Included per seat", enterprise: "Custom / BYOK" } },
      { label: "SSH targets", values: { free: "1", team: "Unlimited", enterprise: "Unlimited" } },
    ],
  },
  {
    title: "Team work",
    rows: [
      { label: "Desktop app", values: { free: true, team: true, enterprise: true } },
      { label: "Web and mobile dispatch", values: { free: true, team: true, enterprise: true } },
      { label: "Local workspaces and worktrees", values: { free: true, team: true, enterprise: true } },
      { label: "Personal cloud workspaces", values: { free: true, team: true, enterprise: true } },
      { label: "Shared cloud workspaces", values: { free: false, team: true, enterprise: true } },
      { label: "Slack integration", values: { free: false, team: true, enterprise: true } },
      { label: "Automations", pill: "Beta", values: { free: "Definitions", team: "Cloud runs", enterprise: "Cloud runs" } },
      { label: "Plugins, MCPs, skills", values: { free: "Personal", team: "Shared across team", enterprise: "Shared across org" } },
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
