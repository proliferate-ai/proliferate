export type CloudSettingsSectionId =
  | "account"
  | "environments"
  | "organization"
  | "sso"
  | "teams"
  | "billing"
  | "support";

export type CloudSettingsCanonicalSectionId = Exclude<CloudSettingsSectionId, "teams">;

export type CloudSettingsIconToken =
  | "account"
  | "branch"
  | "organization"
  | "sso"
  | "billing"
  | "support";

export interface CloudSettingsSectionDefinition {
  id: CloudSettingsCanonicalSectionId;
  label: string;
  iconToken: CloudSettingsIconToken;
  mobileRelevant: boolean;
}

export const WEB_CLOUD_SETTINGS_SECTIONS: readonly CloudSettingsSectionDefinition[] = [
  {
    id: "account",
    label: "Account",
    iconToken: "account",
    mobileRelevant: true,
  },
  {
    id: "environments",
    label: "Environments",
    iconToken: "branch",
    mobileRelevant: true,
  },
  {
    id: "organization",
    label: "Organization",
    iconToken: "organization",
    mobileRelevant: true,
  },
  {
    id: "sso",
    label: "Single sign-on",
    iconToken: "sso",
    mobileRelevant: false,
  },
  {
    id: "billing",
    label: "Billing",
    iconToken: "billing",
    mobileRelevant: true,
  },
  {
    id: "support",
    label: "Support",
    iconToken: "support",
    mobileRelevant: false,
  },
];

const SECTION_IDS = new Set<CloudSettingsSectionId>([
  "account",
  "environments",
  "organization",
  "sso",
  "teams",
  "billing",
  "support",
]);

export function normalizeCloudSettingsSectionId(
  value: string | null | undefined,
): CloudSettingsCanonicalSectionId {
  if (value === "teams") {
    return "organization";
  }
  return isCloudSettingsSectionId(value) && value !== "teams" ? value : "account";
}

export function isCloudSettingsSectionId(
  value: string | null | undefined,
): value is CloudSettingsSectionId {
  return typeof value === "string" && SECTION_IDS.has(value as CloudSettingsSectionId);
}

export function mobileCloudSettingsSections(): readonly CloudSettingsSectionDefinition[] {
  return WEB_CLOUD_SETTINGS_SECTIONS.filter((section) => section.mobileRelevant);
}
