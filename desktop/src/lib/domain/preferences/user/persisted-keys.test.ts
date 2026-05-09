import { describe, expect, it } from "vitest";
import {
  getForwardCompatibleUserPreferenceExtras,
  hasDeprecatedUserPreferenceKeys,
  pickLegacyUserPreferencesInput,
} from "@/lib/domain/preferences/user/persisted-keys";

describe("persisted user preference keys", () => {
  it("splits known legacy input from forward-compatible extras", () => {
    const persisted = {
      themePreset: "mono",
      defaultChatModelId: "gpt-5",
      powersInCodingSessionsEnabled: false,
      onboardingCompletedVersion: 2,
      futureBoolean: true,
      futureNested: { enabled: true },
    };

    expect(pickLegacyUserPreferencesInput(persisted)).toEqual({
      themePreset: "mono",
      defaultChatModelId: "gpt-5",
      powersInCodingSessionsEnabled: false,
    });
    expect(getForwardCompatibleUserPreferenceExtras(persisted)).toEqual({
      futureBoolean: true,
      futureNested: { enabled: true },
    });
    expect(hasDeprecatedUserPreferenceKeys(persisted)).toBe(true);
  });
});
