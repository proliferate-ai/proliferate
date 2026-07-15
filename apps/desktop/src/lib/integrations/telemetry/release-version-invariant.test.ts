// Version-source invariant checks for the release-identity contract
// (parse_client_release_id requires `<component>@<semver>+<12-hex-sha>`).
// These guard the version *sources* that feed each app's telemetry release
// string, so a bump in one file that forgets a sibling file fails tests
// instead of silently producing a mismatched clientReleaseId (or, for
// mobile, a mismatched app.config.ts/package.json pair even though mobile
// has no support surface today).
//
// Mobile has no test runner configured (no vitest/jest/test script in
// apps/mobile/package.json), so its invariant is co-located here — the
// lowest-friction place that actually runs in CI — rather than scaffolding
// a whole test framework for one assertion. This file reads mobile's source
// files by absolute path relative to the repo root.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${repoRoot}${relativePath}`, "utf-8"));
}

function readText(relativePath: string): string {
  return readFileSync(`${repoRoot}${relativePath}`, "utf-8");
}

function cargoTomlVersion(text: string): string {
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('Could not find a `version = "..."` line in Cargo.toml');
  }
  return match[1];
}

function appConfigTsVersion(text: string): string {
  const match = text.match(/version:\s*"([^"]+)"/);
  if (!match) {
    throw new Error('Could not find a `version: "..."` field in app.config.ts');
  }
  return match[1];
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

describe("release version-source invariants", () => {
  it("desktop package.json, tauri.conf.json, and Cargo.toml agree on version", () => {
    const packageVersion = readJson("apps/desktop/package.json").version;
    const tauriVersion = readJson("apps/desktop/src-tauri/tauri.conf.json").version;
    const cargoVersion = cargoTomlVersion(readText("apps/desktop/src-tauri/Cargo.toml"));

    expect(tauriVersion).toBe(packageVersion);
    expect(cargoVersion).toBe(packageVersion);
  });

  it("mobile app.config.ts and package.json agree on version", () => {
    const packageVersion = readJson("apps/mobile/package.json").version;
    const configVersion = appConfigTsVersion(readText("apps/mobile/app.config.ts"));

    expect(configVersion).toBe(packageVersion);
  });

  it("anyharness/sdk package.json version is valid semver (runtime trio version source)", () => {
    const version = readJson("anyharness/sdk/package.json").version;

    expect(typeof version).toBe("string");
    expect(version as string).toMatch(SEMVER_RE);
  });
});
