export const SETTINGS_SCAFFOLD_PAGE_IDS = [
  "organization-model-policy",
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
} as const;

export function isSettingsScaffoldPageId(value: string): value is SettingsScaffoldPageId {
  return SETTINGS_SCAFFOLD_PAGE_IDS.some((pageId) => pageId === value);
}
