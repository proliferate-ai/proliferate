// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  readDevUpdaterMock,
  writeDevUpdaterMock,
  type DevUpdaterMockState,
} from "./updater-dev-mock";

const DEV_UPDATER_MOCK_KEY = "proliferate.dev.updaterMock";

function baseState(overrides: Partial<DevUpdaterMockState>): DevUpdaterMockState {
  return {
    phase: "available",
    version: "0.1.42",
    downloadProgress: null,
    restartPromptOpen: false,
    restartWhenIdle: false,
    lastCheckedAt: null,
    errorMessage: null,
    errorSource: null,
    manualCheckCompletedAt: null,
    ...overrides,
  };
}

describe("updater dev mock", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips the error phase with both error sources", () => {
    writeDevUpdaterMock(
      baseState({ phase: "error", errorMessage: "no feed", errorSource: "check" }),
    );
    expect(readDevUpdaterMock()).toMatchObject({
      phase: "error",
      errorMessage: "no feed",
      errorSource: "check",
    });

    writeDevUpdaterMock(
      baseState({ phase: "error", errorMessage: "disk full", errorSource: "download" }),
    );
    expect(readDevUpdaterMock()).toMatchObject({
      phase: "error",
      errorSource: "download",
    });
  });

  it("round-trips the manual-check-current signal", () => {
    writeDevUpdaterMock(baseState({ phase: "current", manualCheckCompletedAt: 1_234 }));

    expect(readDevUpdaterMock()).toMatchObject({
      phase: "current",
      manualCheckCompletedAt: 1_234,
    });
  });

  it("round-trips an armed restart only for the ready phase", () => {
    writeDevUpdaterMock(baseState({ phase: "ready", restartWhenIdle: true }));
    expect(readDevUpdaterMock()).toMatchObject({ phase: "ready", restartWhenIdle: true });

    writeDevUpdaterMock(baseState({ phase: "available", restartWhenIdle: true }));
    expect(readDevUpdaterMock()).toMatchObject({ phase: "available", restartWhenIdle: false });
  });

  it("fills defaults when reading a legacy payload without the new fields", () => {
    window.localStorage.setItem(
      DEV_UPDATER_MOCK_KEY,
      JSON.stringify({ phase: "error", version: "0.1.3" }),
    );

    expect(readDevUpdaterMock()).toMatchObject({
      phase: "error",
      errorSource: "check",
      restartWhenIdle: false,
      manualCheckCompletedAt: null,
    });
    expect(readDevUpdaterMock()?.errorMessage).toEqual(expect.any(String));
  });
});
