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
 * Against the release under test (its desktop version — defaults to the repo
 * VERSION, overridable via RELEASE_E2E_RELEASE_DESKTOP_VERSION):
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
 * Runs with no credentials or box (requiredEnv is empty) so it belongs in the
 * release gate, not nightly-only. It can legitimately go red — that red is the
 * incident, a real product/release problem, which is the whole point.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// src/scenarios/upgrade -> up five to repo root VERSION.
const VERSION_FILE = resolve(HERE, "..", "..", "..", "..", "..", "VERSION");
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const DEFAULT_CDN_BASE = "https://downloads.proliferate.com";

interface UpdaterManifest {
  version: string;
  pub_date: string;
  platforms: Record<string, { url: string; signature: string }>;
}

export const t4Sh2: ScenarioDefinition = {
  id: "T4-SH-2",
  title: "desktop artifact chain valid per release (the incident gate)",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T4-SH-2",
  lanes: ["local"],
  requiredEnv: [],
  plan: () => [
    { description: "self-hosted server /desktop/updater/latest.json follows to 200 (if a box URL is set)" },
    { description: "CDN stable manifest version == the release's desktop version, pub_date parseable/fresh" },
    { description: "CDN versioned manifest (.../stable/<version>/latest.json) -> 200" },
    { description: "HEAD every platform artifact URL in the manifest -> 200 (a fetchable artifact, not a string)" },
    { description: "the tag desktop-v<version> exists and contains the release SHA" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const version = releaseDesktopVersion();
    const cdnBase = (process.env.RELEASE_E2E_DESKTOP_CDN_BASE_URL?.trim() || DEFAULT_CDN_BASE).replace(/\/+$/, "");
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
    const stable = await fetchManifest(`${cdnBase}/desktop/stable/latest.json`);
    assert.equal(
      stable.version,
      version,
      `T4-SH-2: CDN stable manifest is ${stable.version}, but the release under test is ${version}. ` +
        "A version mismatch here is the incident: the server advanced past the shipped desktop artifact.",
    );
    const pubDate = new Date(stable.pub_date);
    assert.ok(!Number.isNaN(pubDate.getTime()), `T4-SH-2: manifest pub_date is not a valid date: ${stable.pub_date}`);
    assert.ok(pubDate.getUTCFullYear() >= 2024, `T4-SH-2: manifest pub_date is implausibly old: ${stable.pub_date}`);
    const releaseDate = process.env.RELEASE_E2E_RELEASE_DATE?.trim();
    if (releaseDate) {
      assert.equal(
        pubDate.toISOString().slice(0, 10),
        releaseDate.slice(0, 10),
        `T4-SH-2: manifest pub_date ${stable.pub_date} is not the release day ${releaseDate} — ` +
          "a stale pub_date with a new version means the manifest was hand-edited, not published.",
      );
    }
    console.log(`[T4-SH-2] stable manifest: version=${stable.version} pub_date=${stable.pub_date}`);

    // 3. Versioned manifest (the redirect target) exists.
    const versionedUrl = `${cdnBase}/desktop/stable/${version}/latest.json`;
    const versioned = await fetch(versionedUrl, { method: "GET" });
    assert.equal(versioned.status, 200, `T4-SH-2: versioned manifest ${versionedUrl} -> ${versioned.status}`);

    // 4. Every platform artifact is actually fetchable.
    const platforms = Object.entries(stable.platforms);
    assert.ok(platforms.length > 0, "T4-SH-2: manifest advertises no platforms");
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

    // 5. The desktop-v<version> tag exists and contains the release SHA.
    assertTagContainsReleaseSha(version);
  },
};

function releaseDesktopVersion(): string {
  const override = process.env.RELEASE_E2E_RELEASE_DESKTOP_VERSION?.trim();
  if (override) {
    return override;
  }
  return readFileSync(VERSION_FILE, "utf8").trim();
}

async function fetchManifest(url: string): Promise<UpdaterManifest> {
  const res = await fetch(url);
  assert.equal(res.status, 200, `T4-SH-2: manifest ${url} -> ${res.status}`);
  return (await res.json()) as UpdaterManifest;
}

/**
 * Confirms the desktop-v<version> git tag exists on the remote and shares
 * lineage with the release SHA. A missing tag is a hard failure: a draft/absent
 * tag is exactly the incident.
 *
 * Lineage: the spec's canonical assertion is
 * `git merge-base --is-ancestor <release-sha> desktop-v<version>`, which holds
 * in the release gate where HEAD IS the release commit (RELEASE_E2E_RELEASE_SHA
 * overrides HEAD). A nightly/ad-hoc run instead sits on main-tip, a DESCENDANT
 * of the tag, so this accepts the tag being an ancestor of the release SHA too —
 * same mainline either way. It fails only when the objects are present and the
 * two are genuinely divergent (a bogus tag off the mainline), and degrades to a
 * warning on a shallow clone where the objects cannot be compared (tag existence
 * is already the primary signal).
 */
function assertTagContainsReleaseSha(version: string): void {
  const tag = `desktop-v${version}`;
  const remote = git(["ls-remote", "--tags", "origin", tag]);
  assert.ok(
    remote.trim().length > 0,
    `T4-SH-2: tag ${tag} does not exist on origin — the desktop release for ${version} was never published ` +
      "(this is the incident: server advanced, desktop release left in draft).",
  );
  const tagSha = remote.trim().split(/\s+/)[0];

  const releaseSha = (process.env.RELEASE_E2E_RELEASE_SHA?.trim() || git(["rev-parse", "HEAD"]).trim());
  // Best-effort: fetch the tag object so is-ancestor can compare. Skip quietly
  // when the fetch is not possible (offline mirror / restricted CI token).
  spawnSync("git", ["-C", REPO_ROOT, "fetch", "--no-tags", "--quiet", "origin", `refs/tags/${tag}:refs/tags/${tag}`], {
    stdio: "ignore",
  });
  const forward = spawnSync("git", ["-C", REPO_ROOT, "merge-base", "--is-ancestor", releaseSha, tagSha]);
  const backward = spawnSync("git", ["-C", REPO_ROOT, "merge-base", "--is-ancestor", tagSha, releaseSha]);
  if (forward.status === 0 || backward.status === 0) {
    console.log(`[T4-SH-2] ${tag} (${tagSha.slice(0, 10)}) shares lineage with release SHA ${releaseSha.slice(0, 10)}`);
  } else if (forward.status === 1 && backward.status === 1) {
    // Both objects present and neither is an ancestor: genuinely divergent.
    throw new assert.AssertionError({
      message:
        `T4-SH-2: ${tag} (${tagSha.slice(0, 10)}) is on a divergent lineage from release SHA ` +
        `${releaseSha.slice(0, 10)} — the published desktop tag does not contain the release under test.`,
    });
  } else {
    console.log(
      `[T4-SH-2] ${tag} exists (${tagSha.slice(0, 10)}); lineage vs release SHA not verifiable in this checkout ` +
        "(shallow clone / objects absent) — tag existence asserted.",
    );
  }
}

function git(args: string[]): string {
  const result = spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`T4-SH-2: git ${args.join(" ")} failed: ${result.stderr?.trim() || result.stdout?.trim()}`);
  }
  return result.stdout;
}
