export const SETTINGS_SCAFFOLD_PAGE_IDS = [
  "organization-integrations",
  "organization-model-policy",
  "organization-limits",
] as const;

export type SettingsScaffoldPageId = (typeof SETTINGS_SCAFFOLD_PAGE_IDS)[number];

export interface SettingsScaffoldRowCopy {
  label: string;
  description: string;
}

export interface SettingsScaffoldPageCopy {
  title: string;
  description: string;
  rows: SettingsScaffoldRowCopy[];
}

export const SETTINGS_SCAFFOLD_COPY: Record<SettingsScaffoldPageId, SettingsScaffoldPageCopy> = {
  "organization-integrations": {
    title: "Organization integrations",
    description: "Team-wide connections used by organization cloud work, workflows, Slack, and API-dispatched sessions.",
    rows: [
      {
        label: "Connected services",
        description: "Organization-owned GitHub, Slack, MCP, integration, and provider connections for shared work.",
      },
      {
        label: "Access and visibility",
        description: "Admin-managed availability for organization work and member access.",
      },
      {
        label: "Audit surface",
        description: "Connection status, last validation time, and usage references for each integration.",
      },
    ],
  },
  "organization-model-policy": {
    title: "Model policy",
    description: "Organization-wide model availability and default model choices for shared work.",
    rows: [
      {
        label: "Allowed models",
        description: "Admins choose which hosted and BYOK models organization work can launch.",
      },
      {
        label: "Default routing",
        description: "Organization cloud, Slack, workflow, and API entrypoints use this policy by default.",
      },
      {
        label: "Provider constraints",
        description: "Provider-level constraints applied across organization-owned work.",
      },
    ],
  },
  "organization-limits": {
    title: "Limits",
    description: "Organization guardrails for LLM spend, runtime usage, and member-level budgets.",
    rows: [
      {
        label: "Per-user LLM spend",
        description: "Member budgets and enforcement behavior for organization-funded model usage.",
      },
      {
        label: "Runtime usage",
        description: "Organization cloud and SSH usage caps aligned with organization spend controls.",
      },
      {
        label: "Alerts",
        description: "Budget and usage alerts for admins and affected members.",
      },
    ],
  },
} as const;

export function isSettingsScaffoldPageId(value: string): value is SettingsScaffoldPageId {
  return SETTINGS_SCAFFOLD_PAGE_IDS.some((pageId) => pageId === value);
}
