import { describe, expect, it } from "vitest";

import {
  mobileCloudSettingsSections,
  normalizeCloudSettingsSectionId,
  WEB_CLOUD_SETTINGS_SECTIONS,
} from "./cloud-settings";

describe("cloud settings section model", () => {
  it("normalizes legacy teams links to organization", () => {
    expect(normalizeCloudSettingsSectionId("teams")).toBe("organization");
    expect(normalizeCloudSettingsSectionId("billing")).toBe("billing");
    expect(normalizeCloudSettingsSectionId("appearance")).toBe("account");
    expect(normalizeCloudSettingsSectionId(undefined)).toBe("account");
  });

  it("excludes desktop-only settings from the cloud section list", () => {
    expect(WEB_CLOUD_SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "account",
      "personal-secrets",
      "environments",
      "organization",
      "organization-secrets",
      "sso",
      "billing",
      "support",
    ]);
    expect(WEB_CLOUD_SETTINGS_SECTIONS.some((section) => section.id === "support")).toBe(true);
    expect(WEB_CLOUD_SETTINGS_SECTIONS.map((section) => section.id)).not.toContain("appearance");
  });

  it("provides mobile-relevant cloud sections from the same model", () => {
    expect(mobileCloudSettingsSections().map((section) => section.id)).toEqual([
      "account",
      "personal-secrets",
      "environments",
      "organization",
      "organization-secrets",
      "billing",
    ]);
  });
});
