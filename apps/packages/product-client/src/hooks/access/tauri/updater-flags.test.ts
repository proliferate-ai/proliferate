import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPDATER_FLAGS,
  normalizeUpdaterFlags,
} from "./updater-flags";

describe("updater flags", () => {
  it("defaults owned ON and server-redirect OFF", () => {
    expect(DEFAULT_UPDATER_FLAGS).toEqual({
      ownedUpdaterEnabled: true,
      updaterServerRedirectEnabled: false,
    });
  });

  it("falls back to the defaults for missing, null, or wrong-typed input", () => {
    expect(normalizeUpdaterFlags(undefined)).toEqual(DEFAULT_UPDATER_FLAGS);
    expect(normalizeUpdaterFlags(null)).toEqual(DEFAULT_UPDATER_FLAGS);
    expect(normalizeUpdaterFlags("nonsense")).toEqual(DEFAULT_UPDATER_FLAGS);
    expect(
      normalizeUpdaterFlags({ ownedUpdaterEnabled: "yes" }),
    ).toEqual(DEFAULT_UPDATER_FLAGS);
  });

  it("honors an explicit per-field override", () => {
    expect(
      normalizeUpdaterFlags({ ownedUpdaterEnabled: false }),
    ).toEqual({
      ownedUpdaterEnabled: false,
      updaterServerRedirectEnabled: false,
    });
    expect(
      normalizeUpdaterFlags({ updaterServerRedirectEnabled: true }),
    ).toEqual({
      ownedUpdaterEnabled: true,
      updaterServerRedirectEnabled: true,
    });
  });
});
