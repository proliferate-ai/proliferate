import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { ScenarioDefinition } from "../types.js";

/**
 * T4-SH-2 — desktop artifact chain (the 2026-07-09 incident test).
 * specs/developing/testing/self-hosting.md#T4-SH-2 (§5)
 *
 * The incident: the server advanced to a new version while no shipped desktop
 * artifact contained the launch-flagship feature — every desktop-v* GitHub
 * release sat in draft, yet the versions all looked consistent. No existing
 * check catches this class, because version-string equality is a lying
 * assertion: only a fetchable artifact proves a release shipped.
 *
 * Against a published release (its desktop version defaults to the CDN stable
 * manifest, overridable via RELEASE_E2E_RELEASE_DESKTOP_VERSION):
 *   1. A self-hosted server's GET /desktop/updater/latest.json follows to 200
 *      (only when RELEASE_E2E_SELFHOST_URL is set; the server redirect is
 *      display-only and points at the CDN, so this is additive).
 *   2. CDN stable manifest -> version == the release's desktop version, and a
 *      parseable pub_date (== release day when RELEASE_E2E_RELEASE_DATE is
 *      given; a stale pub_date with a "new" version means a hand-edit, not a
 *      publish).
 *   3. CDN versioned manifest (.../stable/<version>/latest.json) -> 200 (the
 *      target the server redirect resolves to).
 *   4. HEAD every platform artifact URL in the manifest -> 200.
 *   5. The tag desktop-v<version> exists and contains the release SHA.
 *
 * Runs with no credentials or box (requiredEnv is empty). The current caller is
 * a nightly/manual post-publish diagnostic. It is not the pre-publish
 * T4-ARTIFACT-1 gate: that future gate must inspect the immutable candidate
 * manifest before it moves the stable pointer.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const DEFAULT_CDN_BASE = "https://downloads.proliferate.com";
const PLATFORM_CONTRACT_FILE = resolve(REPO_ROOT, "fixtures", "contracts", "desktop-updater", "platforms.json");

interface UpdaterManifest {
  version: string;
  pub_date: string;
  platforms: Record<string, { url: string; signature: string }>;
}

export const t4Sh2: ScenarioDefinition = {
  id: "T4-SH-2",
  title: "published desktop artifact chain diagnostic",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T4-SH-2",
  lanes: ["local"],
  requiredEnv: [],
  plan: () => [
    { description: "self-hosted server /desktop/updater/latest.json follows to 200 (if a box URL is set)" },
    { description: "CDN stable manifest agrees with the published version and independent tag release day" },
    { description: "CDN versioned manifest (.../stable/<version>/latest.json) -> 200" },
    { description: "manifest contains exactly every shipped updater platform and each artifact HEAD returns 200" },
    { description: "the tag contains the exact candidate SHA when supplied; otherwise it is on the published mainline" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const cdnBase = (process.env.RELEASE_E2E_DESKTOP_CDN_BASE_URL?.trim() || DEFAULT_CDN_BASE).replace(/\/+$/, "");
    const stable = await fetchManifest(`${cdnBase}/desktop/stable/latest.json`);
    const version = resolvePublishedDesktopVersion(process.env.RELEASE_E2E_RELEASE_DESKTOP_VERSION, stable.version);
    console.log(`[T4-SH-2] release desktop version under test: ${version} (CDN ${cdnBase})`);

    // 1. Self-hosted server redirect (additive; only when a box URL is present).
    const serverUrl = process.env.RELEASE_E2E_SELFHOST_URL?.trim();
    if (serverUrl) {
      const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/desktop/updater/latest.json`, { redirect: "follow" });
      assert.equal(res.status, 200, `T4-SH-2: server updater redirect did not follow to 200 (got ${res.status})`);
      console.log(`[T4-SH-2] server redirect -> ${res.url} (200)`);
    } else {
      console.log("[T4-SH-2] RELEASE_E2E_SELFHOST_URL unset — skipping the server-redirect sub-check (CDN is ground truth)");
    }

    // 2. CDN stable manifest: version match + pub_date freshness.
    assert.equal(
      stable.version,
      version,
      `T4-SH-2: CDN stable manifest is ${stable.version}, but the release under test is ${version}. ` +
        "A version mismatch here is the incident: the server advanced past the shipped desktop artifact.",
    );
    const tag = assertPublishedTagLineage(version);
    const releaseDate = resolveExpectedReleaseDate(process.env.RELEASE_E2E_RELEASE_DATE, tag.creationDate);
    assert.equal(
      utcDate(stable.pub_date, "manifest pub_date"),
      releaseDate,
      `T4-SH-2: manifest pub_date ${stable.pub_date} is not the independent release day ${releaseDate} — ` +
        "a stale pub_date with a new version means the manifest was hand-edited, not published.",
    );
    console.log(`[T4-SH-2] stable manifest: version=${stable.version} pub_date=${stable.pub_date}`);

    // 3. Versioned manifest (the redirect target) exists.
    const versionedUrl = `${cdnBase}/desktop/stable/${version}/latest.json`;
    const versioned = await fetchManifest(versionedUrl);
    assert.deepEqual(
      versioned,
      stable,
      `T4-SH-2: stable and immutable versioned manifests disagree for ${version}; the stable pointer is not backed by its snapshot`,
    );

    // 4. Every platform artifact is actually fetchable.
    const expectedPlatforms = updaterPlatformKeys(
      JSON.parse(readFileSync(PLATFORM_CONTRACT_FILE, "utf8")) as unknown,
    );
    assertExactUpdaterPlatforms(Object.keys(stable.platforms), expectedPlatforms);
    const platforms = Object.entries(stable.platforms);
    for (const [platform, entry] of platforms) {
      const head = await fetch(entry.url, { method: "HEAD" });
      assert.equal(
        head.status,
        200,
        `T4-SH-2: artifact for ${platform} is not fetchable: HEAD ${entry.url} -> ${head.status}. ` +
          "A manifest that names an absent artifact is the incident class this gate exists to catch.",
      );
      assert.ok(entry.signature && entry.signature.length > 0, `T4-SH-2: ${platform} manifest entry has no signature`);
      console.log(`[T4-SH-2] artifact ${platform} HEAD 200: ${entry.url}`);
    }
  },
};

export function resolvePublishedDesktopVersion(explicitVersion: string | undefined, stableVersion: string): string {
  return explicitVersion?.trim() || stableVersion.trim();
}

export function resolveExpectedReleaseDate(explicitDate: string | undefined, tagCreationDate: string): string {
  return utcDate(explicitDate?.trim() || tagCreationDate, "release date");
}

export function updaterPlatformKeys(contract: unknown): string[] {
  assert.ok(contract && typeof contract === "object", "T4-SH-2: updater platform contract is not an object");
  const value = contract as { schemaVersion?: unknown; platforms?: unknown };
  assert.equal(value.schemaVersion, 1, "T4-SH-2: unsupported updater platform contract schema");
  assert.ok(Array.isArray(value.platforms), "T4-SH-2: updater platform contract has no platform list");
  const platforms = value.platforms as unknown[];
  assert.ok(platforms.length > 0, "T4-SH-2: updater platform contract is empty");
  assert.ok(
    platforms.every((platform) => typeof platform === "string" && platform.length > 0),
    "T4-SH-2: updater platform contract contains an invalid key",
  );
  const keys = platforms as string[];
  assert.equal(new Set(keys).size, keys.length, "T4-SH-2: updater platform contract contains duplicate keys");
  return [...keys];
}

export function assertExactUpdaterPlatforms(actual: readonly string[], expected: readonly string[]): void {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    "T4-SH-2: published updater manifest platform set does not match the shipped platform contract",
  );
}

export interface LineageAssertion {
  ancestor: string;
  descendant: string;
  mode: "exact-candidate" | "published-diagnostic";
}

export function lineageAssertion(
  releaseSha: string | undefined,
  tagSha: string,
  publishedRefSha: string,
): LineageAssertion {
  const candidate = releaseSha?.trim();
  if (candidate) {
    return { ancestor: candidate, descendant: tagSha, mode: "exact-candidate" };
  }
  return { ancestor: tagSha, descendant: publishedRefSha, mode: "published-diagnostic" };
}

async function fetchManifest(url: string): Promise<UpdaterManifest> {
  const res = await fetch(url);
  assert.equal(res.status, 200, `T4-SH-2: manifest ${url} -> ${res.status}`);
  return (await res.json()) as UpdaterManifest;
}

/**
 * Confirms the desktop-v<version> git tag exists on the remote. With an exact
 * RELEASE_E2E_RELEASE_SHA it enforces only the contract direction: the release
 * SHA must be an ancestor of the tag. It never accepts an older tag merely
 * because that tag is an ancestor of a newer candidate.
 *
 * Nightly/manual post-publish diagnostics normally omit the candidate SHA. In
 * that explicitly weaker mode, the published tag must be reachable from the
 * remote mainline. That result is monitoring signal, not exact-candidate
 * qualification.
 */
function assertPublishedTagLineage(version: string): { creationDate: string; tagSha: string } {
  const tag = `desktop-v${version}`;
  const tagRef = `refs/tags/${tag}`;
  const peeledRef = `${tagRef}^{}`;
  const remote = git(["ls-remote", "--tags", "origin", tagRef, peeledRef]);
  assert.ok(
    remote.trim().length > 0,
    `T4-SH-2: tag ${tag} does not exist on origin — the desktop release for ${version} was never published ` +
      "(this is the incident: server advanced, desktop release left in draft).",
  );
  const remoteRefs = new Map(
    remote
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/, 2) as [string, string])
      .map(([sha, ref]) => [ref, sha]),
  );
  const remoteCommitSha = remoteRefs.get(peeledRef) || remoteRefs.get(tagRef);
  assert.ok(remoteCommitSha, `T4-SH-2: remote returned no exact ${tagRef} ref`);

  git(["fetch", "--force", "--no-tags", "--quiet", "origin", `${tagRef}:${tagRef}`]);
  const tagSha = git(["rev-parse", `${tagRef}^{commit}`]).trim();
  assert.equal(tagSha, remoteCommitSha, `T4-SH-2: fetched ${tag} does not match its advertised remote commit`);

  // The runner is often invoked from a long-lived local worktree whose
  // remote-tracking ref is stale. Refresh the published branch before using it
  // as the weaker monitoring comparison.
  git([
    "fetch",
    "--force",
    "--no-tags",
    "--quiet",
    "origin",
    "refs/heads/main:refs/remotes/origin/main",
  ]);
  const publishedRefSha = git(["rev-parse", "refs/remotes/origin/main^{commit}"]).trim();
  const releaseSha = process.env.RELEASE_E2E_RELEASE_SHA?.trim();
  const normalizedReleaseSha = releaseSha ? git(["rev-parse", `${releaseSha}^{commit}`]).trim() : undefined;
  const lineage = lineageAssertion(normalizedReleaseSha, tagSha, publishedRefSha);
  const result = spawnSync(
    "git",
    ["-C", REPO_ROOT, "merge-base", "--is-ancestor", lineage.ancestor, lineage.descendant],
    { encoding: "utf8" },
  );
  if (result.status === 1) {
    const subject = lineage.mode === "exact-candidate" ? "release candidate" : "published mainline";
    throw new assert.AssertionError({
      message:
        `T4-SH-2: ${tag} (${tagSha.slice(0, 10)}) does not contain/reach the ${subject} ` +
        `${lineage.mode === "exact-candidate" ? lineage.ancestor : lineage.descendant} in the required direction.`,
    });
  }
  assert.equal(
    result.status,
    0,
    `T4-SH-2: unable to verify ${lineage.mode} ancestry: ${result.stderr?.trim() || `git exited ${result.status}`}`,
  );
  console.log(
    lineage.mode === "exact-candidate"
      ? `[T4-SH-2] ${tag} (${tagSha.slice(0, 10)}) contains release SHA ${lineage.ancestor.slice(0, 10)}`
      : `[T4-SH-2] ${tag} (${tagSha.slice(0, 10)}) is reachable from origin/main ${publishedRefSha.slice(0, 10)} (published diagnostic)`,
  );
  // An annotated tag's creation date is independent of its target commit date;
  // lightweight tags naturally fall back to the commit's creator date.
  const creationDate = git([
    "for-each-ref",
    "--format=%(creatordate:iso-strict)",
    tagRef,
  ]).trim();
  assert.ok(creationDate, `T4-SH-2: ${tag} has no usable creation date`);
  return { creationDate, tagSha };
}

function utcDate(value: string, label: string): string {
  const parsed = new Date(value);
  assert.ok(!Number.isNaN(parsed.getTime()), `T4-SH-2: ${label} is not a valid date: ${value}`);
  return parsed.toISOString().slice(0, 10);
}

function git(args: string[]): string {
  const result = spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`T4-SH-2: git ${args.join(" ")} failed: ${result.stderr?.trim() || result.stdout?.trim()}`);
  }
  return result.stdout;
}
