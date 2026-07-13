/**
 * Dev-candidate manifest builder.
 *
 * Assembles a best-effort LOCAL candidate manifest from the current
 * worktree so world adapters have something to consume before the full
 * build pipeline exists. It never fabricates a digest: every available slot
 * is hashed from real bytes found on disk, and every slot this builder
 * cannot honestly produce (a docker image, a Tauri bundle, a built web
 * bundle, an E2B template, a LiteLLM image) is marked explicitly
 * unavailable with a reason. This is a developer convenience, not a
 * substitute for `loadCandidateManifest` against a real release build.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ArtifactLocator, CandidateManifest, PlatformKey, Slot } from "../contracts/artifacts.js";

export interface DevCandidateManifestOptions {
  /** Repo root to build from; defaults to `git rev-parse --show-toplevel` from cwd. */
  readonly repoRoot?: string;
  /** Host platform to look for built binaries under; defaults to the detected host. Pass `null` to skip. */
  readonly platform?: PlatformKey | null;
  /** Injectable for tests: runs `git <args>` in `cwd` and returns trimmed stdout. */
  readonly runGit?: (args: readonly string[], cwd: string) => string;
}

const BINARY_CRATE_NAME: Readonly<Record<"anyharness" | "worker" | "supervisor", string>> = {
  anyharness: "anyharness",
  worker: "proliferate-worker",
  supervisor: "proliferate-supervisor",
};

export function detectHostPlatformKey(
  platform: string = process.platform,
  arch: string = process.arch,
): PlatformKey | null {
  if (platform === "darwin" && arch === "arm64") return "darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "darwin-x86_64";
  if (platform === "linux" && arch === "x64") return "linux-x86_64";
  if (platform === "linux" && arch === "arm64") return "linux-aarch64";
  return null;
}

function defaultRunGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function hashFileSlot(filePath: string, missingReason: string): Slot<string> {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return { available: false, reason: missingReason };
  }
  return { available: true, value: hashFile(filePath) };
}

function binarySlotMap(
  repoRoot: string,
  crateName: string,
  platform: PlatformKey | null,
): Partial<Record<PlatformKey, Slot<ArtifactLocator>>> {
  if (platform === null) {
    // No detected/requested platform: we cannot honestly claim a slot key,
    // so this map is left empty rather than guessing one.
    return {};
  }
  const candidates = ["release", "debug"].map((profile) => path.join(repoRoot, "target", profile, crateName));
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!found) {
    return {
      [platform]: {
        available: false,
        reason: `no built "${crateName}" binary found at ${candidates.join(" or ")}; run \`cargo build --release -p ${crateName}\``,
      },
    };
  }
  const stats = statSync(found);
  return {
    [platform]: {
      available: true,
      value: { locator: found, digest: hashFile(found), algorithm: "sha256", sizeBytes: stats.size },
    },
  };
}

/**
 * Builds a best-effort local candidate manifest. Never throws on a missing
 * artifact — missing slots are reported `available: false` with a reason;
 * the git commands themselves (`rev-parse`/`status`) are expected to
 * succeed inside any checked-out worktree and will throw if they do not
 * (there is no honest fallback for "what commit is this").
 */
export function buildDevCandidateManifest(options: DevCandidateManifestOptions = {}): CandidateManifest {
  const runGit = options.runGit ?? defaultRunGit;
  const repoRoot = options.repoRoot ?? runGit(["rev-parse", "--show-toplevel"], process.cwd());
  const platform = options.platform === undefined ? detectHostPlatformKey() : options.platform;

  const sourceSha = runGit(["rev-parse", "HEAD"], repoRoot);
  const dirtyStatus = runGit(["status", "--porcelain"], repoRoot);
  // Best-effort proxy, not a true tree-content hash: stable for a clean
  // checkout at this SHA and distinguishable once the tree is dirty. A real
  // content hash of the built tree belongs to the full build pipeline.
  const sourceContentHash = createHash("sha256").update(`${sourceSha}\n${dirtyStatus}`).digest("hex");

  const catalogPath = path.join(repoRoot, "catalogs/agents/catalog.json");
  const registryPath = path.join(repoRoot, "catalogs/agents/registry.json");

  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha,
    sourceContentHash,
    serverImage: { available: false, reason: "dev-candidate builder does not build docker images; use the CI candidate build" },
    webBuild: { available: false, reason: "dev-candidate builder does not build the web bundle; run the apps/web build and re-run with a real loader" },
    desktopApp: { available: false, reason: "dev-candidate builder does not build/bundle Desktop" },
    desktopUpdater: { available: false, reason: "dev-candidate builder does not produce a signed updater artifact" },
    anyharness: binarySlotMap(repoRoot, BINARY_CRATE_NAME.anyharness, platform),
    worker: binarySlotMap(repoRoot, BINARY_CRATE_NAME.worker, platform),
    supervisor: binarySlotMap(repoRoot, BINARY_CRATE_NAME.supervisor, platform),
    catalogHash: hashFileSlot(catalogPath, `${catalogPath} not found`),
    registryHash: hashFileSlot(registryPath, `${registryPath} not found`),
    e2bTemplate: { available: false, reason: "dev-candidate builder does not build/upload an E2B template" },
    selfHostBundle: { available: false, reason: "dev-candidate builder does not produce a self-host bundle" },
    litellm: { available: false, reason: "dev-candidate builder does not build/publish a LiteLLM image" },
  };
}

async function main(): Promise<void> {
  const manifest = buildDevCandidateManifest();
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

// Exact-URL comparison (not a filename substring match) so importing this
// module from a test file — whose name also contains "dev-candidate-builder"
// — never triggers the CLI's real git/filesystem calls as a side effect.
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
