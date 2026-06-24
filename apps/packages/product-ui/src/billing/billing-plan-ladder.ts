export type BillingPlanKey = "free" | "core" | "enterprise";
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
    tagline: "Evaluation and small teams.",
    price: "$0",
    suffix: "forever",
    billing: "Includes 5 PCUs",
    highlightsLabel: "Includes",
    highlights: [
      "5 Proliferate Credits",
      "1 workflow per person",
      "Up to 5 team members",
      "Hosted gateway auth",
      "Any local auth option",
    ],
  },
  {
    key: "core",
    name: "Core",
    tagline: "Organization cloud for growing teams.",
    price: "From 20 PCUs",
    suffix: "per month",
    billing: "20 / 50 / 100 / 200 / 500 PCU memberships",
    featured: true,
    highlightsLabel: "Everything in Free, plus",
    highlights: [
      "Monthly Core credit memberships",
      "Unlimited workflows per person",
      "Unlimited team members",
      "Capped top up billing",
      "Beta access and role-based access management",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    tagline: "Custom security, deployment, and support.",
    price: "Custom",
    suffix: "request trial",
    billing: "Custom credits, deployment, and contract terms",
    highlightsLabel: "Everything in Core, plus",
    highlights: [
      "Custom Proliferate Credits",
      "SSO, org-wide secrets, and audit trails",
      "Bring your own model credentials",
      "Custom instance types or VPC deployment",
      "Dedicated account manager, FDE, and premium support",
    ],
  },
];

export const BILLING_PLAN_SECTIONS: BillingPlanSection[] = [
  {
    title: "Usage and limits",
    rows: [
      { label: "Proliferate Credits", values: { free: "5 PCUs", core: "20 / 50 / 100 / 200 / 500 PCUs", enterprise: "Custom" } },
      { label: "Credit top up", values: { free: false, core: "Capped billing", enterprise: "Custom" } },
      { label: "Workflows per person", values: { free: "1", core: "Unlimited", enterprise: "Unlimited" } },
      { label: "Team members", values: { free: "5", core: "Unlimited", enterprise: "Unlimited" } },
      { label: "Budgets per person", values: { free: false, core: false, enterprise: true } },
      { label: "Productivity insights", values: { free: false, core: false, enterprise: true } },
      { label: "Cloud repo environments", values: { free: "Starter", core: "Pooled by organization", enterprise: "Custom" } },
      { label: "Custom instance types", values: { free: false, core: false, enterprise: true } },
    ],
  },
  {
    title: "Collaboration",
    rows: [
      { label: "Desktop app", values: { free: true, core: true, enterprise: true } },
      { label: "Web and mobile dispatch", values: { free: true, core: true, enterprise: true } },
      { label: "Local workspaces and worktrees", values: { free: true, core: true, enterprise: true } },
      { label: "Organization cloud workspaces", values: { free: "Starter", core: true, enterprise: true } },
      { label: "Integrations, MCPs, skills", values: { free: "Personal", core: "Shared across team", enterprise: "Shared across org" } },
      { label: "Programmatic access", values: { free: false, core: false, enterprise: "CLIs + MCPs" } },
      { label: "Beta program", values: { free: false, core: true, enterprise: true } },
    ],
  },
  {
    title: "Auth and security",
    rows: [
      { label: "Cloud auth options", values: { free: "Gateway only", core: "Gateway only", enterprise: "Gateway + BYOK" } },
      { label: "Local auth options", values: { free: "Any local", core: "Any local", enterprise: "Any local" } },
      { label: "Role-based access management", values: { free: false, core: true, enterprise: true } },
      { label: "SSO / SAML", values: { free: false, core: false, enterprise: true } },
      { label: "Org-wide secrets", values: { free: false, core: false, enterprise: true } },
      { label: "Audit trails", values: { free: false, core: false, enterprise: true } },
      { label: "Private VPC deployment", values: { free: false, core: false, enterprise: true } },
    ],
  },
  {
    title: "Support",
    rows: [
      { label: "Docs", values: { free: true, core: true, enterprise: true } },
      { label: "Dedicated account manager", values: { free: false, core: false, enterprise: true } },
      { label: "Forward deployed engineer", values: { free: false, core: false, enterprise: true } },
      { label: "Premium support", values: { free: false, core: false, enterprise: true } },
    ],
  },
];
