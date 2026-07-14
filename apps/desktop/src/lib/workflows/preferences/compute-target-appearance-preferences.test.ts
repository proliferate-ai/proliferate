import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistValue: vi.fn().mockResolvedValue(undefined),
  readPersistedValue: vi.fn(),
}));

vi.mock("@/lib/infra/persistence/preferences-persistence", () => ({
  persistValue: mocks.persistValue,
  readPersistedValue: mocks.readPersistedValue,
}));

import {
  getComputeTargetAppearancePreferences,
  setComputeTargetAppearancePreference,
} from "./compute-target-appearance-preferences";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.persistValue.mockResolvedValue(undefined);
  mocks.readPersistedValue.mockResolvedValue(undefined);
});

describe("compute target appearance preference persistence", () => {
  it("reads and normalizes the existing Tauri-backed preference object", async () => {
    mocks.readPersistedValue.mockResolvedValue({
      first: {
        targetId: " target-1 ",
        displayName: " Main box ",
        iconId: "terminal",
        colorId: "purple",
      },
      invalid: { targetId: "" },
    });

    await expect(getComputeTargetAppearancePreferences()).resolves.toEqual({
      "target-1": {
        targetId: "target-1",
        displayName: "Main box",
        iconId: "terminal",
        colorId: "purple",
      },
    });
  });

  it("merges a normalized preference into the existing persisted object", async () => {
    mocks.readPersistedValue.mockResolvedValue({
      existing: {
        targetId: "existing",
        displayName: null,
        iconId: "cloud",
        colorId: "blue",
      },
    });

    await setComputeTargetAppearancePreference({
      targetId: " target-2 ",
      displayName: " Remote ",
      iconId: "terminal",
      colorId: "green",
    });

    expect(mocks.persistValue).toHaveBeenCalledWith(
      "compute_target_appearance_preferences",
      {
        existing: {
          targetId: "existing",
          displayName: null,
          iconId: "cloud",
          colorId: "blue",
        },
        "target-2": {
          targetId: "target-2",
          displayName: "Remote",
          iconId: "terminal",
          colorId: "green",
        },
      },
    );
  });
});
