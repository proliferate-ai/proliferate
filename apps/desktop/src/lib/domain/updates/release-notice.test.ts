import { describe, expect, it } from "vitest";
import {
  normalizeReleaseTitle,
  normalizeReleaseTitlePair,
  normalizeReleaseVersion,
  parseDesktopReleaseManifest,
  resolveInstalledReleaseTitle,
  selectReleaseNotice,
} from "@/lib/domain/updates/release-notice";

describe("release notice normalization", () => {
  it("normalizes transport whitespace without changing version identity", () => {
    expect(normalizeReleaseVersion(" 0.3.25-beta.1 ")).toBe("0.3.25-beta.1");
    expect(normalizeReleaseVersion("0.3.25\n0.3.26")).toBeNull();
    expect(normalizeReleaseVersion("0.3.25/next")).toBeNull();
  });

  it("accepts a trimmed 80-character title and rejects invalid titles", () => {
    const exactLimit = "a".repeat(80);
    expect(normalizeReleaseTitle(`  ${exactLimit}  `)).toBe(exactLimit);
    expect(normalizeReleaseTitle("a".repeat(81))).toBeNull();
    expect(normalizeReleaseTitle("Introducing Grok\nRead more")).toBeNull();
    expect(normalizeReleaseTitle("\nIntroducing Grok\n")).toBeNull();
    expect(normalizeReleaseTitle("Introducing Grok\u2028Read more")).toBeNull();
    expect(normalizeReleaseTitle("   ")).toBeNull();
  });

  it("bounds the offline cache to one valid version/title pair", () => {
    expect(normalizeReleaseTitlePair({
      version: " 0.3.25 ",
      title: " Introducing Grok ",
    })).toEqual({ version: "0.3.25", title: "Introducing Grok" });
    expect(normalizeReleaseTitlePair({
      version: "0.3.25",
      title: "line one\nline two",
    })).toBeNull();
  });
});

describe("desktop release manifest parsing", () => {
  it("requires the response version to match the requested version exactly", () => {
    expect(parseDesktopReleaseManifest({
      version: "0.3.25",
      notes: "Introducing Grok",
    }, "0.3.25")).toEqual({
      version: "0.3.25",
      title: "Introducing Grok",
    });

    expect(parseDesktopReleaseManifest({
      version: "0.3.26",
      notes: "Introducing Grok",
    }, "0.3.25")).toBeNull();
  });

  it("keeps a matching manifest valid when notes are absent or malformed", () => {
    expect(parseDesktopReleaseManifest({ version: "0.3.25" }, "0.3.25"))
      .toEqual({ version: "0.3.25", title: null });
    expect(parseDesktopReleaseManifest({
      version: "0.3.25",
      notes: "a".repeat(81),
    }, "0.3.25")).toEqual({ version: "0.3.25", title: null });
  });
});

describe("release notice selection", () => {
  const installedRelease = {
    version: "0.3.24",
    title: "Faster workspaces",
  };

  it("shows only the installed release", () => {
    expect(selectReleaseNotice({
      installedRelease,
      acknowledgedReleaseVersion: null,
    })).toEqual(installedRelease);
  });

  it("uses exact version keys for installed acknowledgments", () => {
    expect(selectReleaseNotice({
      installedRelease,
      acknowledgedReleaseVersion: "0.3.24",
    })).toBeNull();
    expect(selectReleaseNotice({
      installedRelease,
      acknowledgedReleaseVersion: "0.3.24-beta.1",
    })).toEqual(installedRelease);
  });

  it("uses only the current version's cached title while offline", () => {
    const cachedRelease = { version: "0.3.25", title: "Introducing Grok" };
    expect(resolveInstalledReleaseTitle({
      currentVersion: "0.3.25",
      manifestStatus: "error",
      manifest: undefined,
      cachedRelease,
    })).toEqual(cachedRelease);
    expect(resolveInstalledReleaseTitle({
      currentVersion: "0.3.26",
      manifestStatus: "error",
      manifest: undefined,
      cachedRelease,
    })).toBeNull();
  });

  it("lets a successful no-title manifest override the offline cache", () => {
    expect(resolveInstalledReleaseTitle({
      currentVersion: "0.3.25",
      manifestStatus: "success",
      manifest: { version: "0.3.25", title: null },
      cachedRelease: { version: "0.3.25", title: "Stale title" },
    })).toBeNull();
  });
});
