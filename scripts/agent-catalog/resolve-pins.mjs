#!/usr/bin/env node
// Resolve each agent harness into a fenced, reproducible install pin and write
// it into catalogs/agents/catalog.json. This is the producer half of the
// "catalog is the lockfile" design: it turns the registry's probe-time
// discovery config (latest-version URLs, ACP registry ids, git refs) into a
// frozen `source` block carrying a concrete, per-platform {url, sha256} (or an
// npm/git specifier). The runtime installer then materializes EXACTLY that,
// sha-verified, with no latest-fetch at install time.
//
//   node scripts/agent-catalog/resolve-pins.mjs [--agent claude,codex]
//       [--no-download]   resolve URLs only, leave sha256 empty (inspection)
//       [--catalog PATH] [--registry PATH]
//
// Real shas require downloading each platform artifact (binaries/archives);
// npm pins capture `npm view dist.integrity`; git pins are anchored by commit.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);
const args = parseArgs(process.argv.slice(2));
const catalogPath = resolve(args.catalog ?? join(REPO_ROOT, "catalogs/agents/catalog.json"));
const registryPath = resolve(args.registry ?? join(REPO_ROOT, "catalogs/agents/registry.json"));
const onlyAgents = args.agent ? new Set(args.agent.split(",")) : null;
const noDownload = Boolean(args.noDownload);
// Platforms we actually ship today: desktop (macOS arm64/x64) + cloud E2B
// (linux x64). Override with --platforms to resolve the full matrix in CI.
const DEFAULT_PLATFORMS = ["macos_arm64", "macos_x64", "linux_x64"];
const platforms = new Set(args.platforms ? args.platforms.split(",") : DEFAULT_PLATFORMS);

const ACP_REGISTRY_URL =
  process.env.ANYHARNESS_ACP_REGISTRY_URL ??
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

// ACP registry platform key -> our registry/catalog platform key.
const ACP_PLATFORM_MAP = {
  "darwin-aarch64": "macos_arm64",
  "darwin-x86_64": "macos_x64",
  "linux-x86_64": "linux_x64",
  "linux-aarch64": "linux_arm64",
  "windows-x86_64": "windows_x64",
  "windows-aarch64": "windows_arm64",
};

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const registryByKind = new Map(registry.agents.map((a) => [a.kind, a]));

let acpRegistryCache = null;
async function acpRegistry() {
  if (!acpRegistryCache) acpRegistryCache = await fetchJson(ACP_REGISTRY_URL);
  return acpRegistryCache;
}

for (const agent of catalog.agents) {
  if (onlyAgents && !onlyAgents.has(agent.kind)) continue;
  const reg = registryByKind.get(agent.kind);
  if (!reg) {
    console.warn(`! ${agent.kind}: not in registry.json — skipping`);
    continue;
  }
  console.log(`\n── ${agent.kind}`);

  if (reg.native && agent.harness.native) {
    const { version, source } = await resolveNative(agent.kind, reg.native.install);
    agent.harness.native.version = version;
    agent.harness.native.source = source;
    console.log(`   native        ${version}  (${source.kind})`);
  }

  const ap = await resolveAgentProcess(
    agent.kind,
    reg.agentProcess.install,
    agent.harness.agentProcess.version,
  );
  if (ap.version) agent.harness.agentProcess.version = ap.version;
  agent.harness.agentProcess.source = ap.source;
  console.log(`   agentProcess  ${ap.version ?? "(kept)"}  (${ap.source.kind})`);
}

writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`\nWrote ${catalogPath}`);

// ── resolvers ────────────────────────────────────────────────────────────────

async function resolveNative(kind, install) {
  if (install.kind === "direct_binary") {
    const version = (await fetchText(install.latestVersionUrl)).trim();
    const targets = {};
    for (const [platKey, vendor] of Object.entries(install.platformMap)) {
      if (!platforms.has(platKey)) continue;
      const url = install.binaryUrlTemplate
        .replaceAll("{version}", version)
        .replaceAll("{platform}", vendor);
      targets[platKey] = { url, sha256: await shaFor(url) };
    }
    return { version, source: { kind: "binary", targets } };
  }
  if (install.kind === "tarball_release") {
    const version = await githubLatestTag(install.versionedUrlTemplate);
    const targets = {};
    for (const [platKey, target] of Object.entries(install.platformMap)) {
      if (!platforms.has(platKey)) continue;
      const url = install.versionedUrlTemplate
        .replaceAll("{version}", version)
        .replaceAll("{target}", target);
      const expectedBinary = install.expectedBinaryTemplate.replaceAll("{target}", target);
      targets[platKey] = { url, sha256: await shaFor(url), expectedBinary };
    }
    return { version, source: { kind: "archive", targets } };
  }
  throw new Error(`${kind}: native install kind '${install.kind}' is not resolvable`);
}

async function resolveAgentProcess(kind, install, currentVersion) {
  if (install.kind === "managed_npm_package") {
    if (isGitSpec(install.package)) {
      const [repo, gitRef] = splitGitSpec(install.package);
      return {
        version: currentVersion,
        source: {
          kind: "git",
          repo,
          gitRef,
          ...(install.packageSubdir ? { packageSubdir: install.packageSubdir } : {}),
          executableRelpath: install.executableRelpath,
        },
      };
    }
    return {
      version: npmVersionOf(install.package) ?? currentVersion,
      source: { kind: "npm", package: install.package, sha256: npmIntegrity(install.package) },
    };
  }
  if (install.kind === "registry_backed") {
    const reg = await acpRegistry();
    const entry = reg.agents.find((a) => a.id === install.registryId);
    if (!entry) throw new Error(`${kind}: '${install.registryId}' not in ACP registry`);
    if (entry.distribution.npx) {
      const pkg = entry.distribution.npx.package; // already pinned `@scope/pkg@ver`
      return {
        version: entry.version ?? npmVersionOf(pkg) ?? currentVersion,
        source: { kind: "npm", package: pkg, sha256: npmIntegrity(pkg) },
      };
    }
    if (entry.distribution.binary) {
      const targets = {};
      for (const [acpKey, target] of Object.entries(entry.distribution.binary)) {
        const ourKey = ACP_PLATFORM_MAP[acpKey];
        if (!ourKey || !platforms.has(ourKey)) continue; // platform we do not ship
        targets[ourKey] = {
          url: target.archive,
          sha256: await shaFor(target.archive),
          expectedBinary: target.cmd,
        };
      }
      return { version: entry.version ?? currentVersion, source: { kind: "archive", targets } };
    }
    throw new Error(`${kind}: ACP entry '${install.registryId}' has no npx/binary distribution`);
  }
  throw new Error(`${kind}: agentProcess install kind '${install.kind}' is not resolvable`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isGitSpec(p) {
  return p.startsWith("git+") || p.startsWith("github:");
}
function splitGitSpec(p) {
  const base = p.replace(/^git\+/, "");
  const hash = base.lastIndexOf("#");
  if (hash === -1) return [base, "HEAD"];
  return [base.slice(0, hash), base.slice(hash + 1)];
}
function npmVersionOf(pkg) {
  // `@scope/name@1.2.3` -> 1.2.3 ; `name@1.2.3` -> 1.2.3
  const at = pkg.lastIndexOf("@");
  if (at <= 0) return null;
  return pkg.slice(at + 1);
}
function npmIntegrity(pkg) {
  if (noDownload) return "";
  const out = spawnSync("npm", ["view", pkg, "dist.integrity"], { encoding: "utf8" });
  if (out.status !== 0) {
    console.warn(`   ! npm view ${pkg} failed: ${out.stderr?.trim()}`);
    return null;
  }
  return out.stdout.trim() || null;
}

async function githubLatestTag(versionedUrlTemplate) {
  // versionedUrlTemplate looks like
  //   https://github.com/<owner>/<repo>/releases/download/{version}/...
  const m = versionedUrlTemplate.match(/github\.com\/([^/]+)\/([^/]+)\/releases/);
  if (!m) throw new Error(`cannot derive GitHub repo from ${versionedUrlTemplate}`);
  const [, owner, repo] = m;
  const rel = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: { "User-Agent": "proliferate-resolve-pins", Accept: "application/vnd.github+json" },
  });
  return rel.tag_name;
}

async function shaFor(url) {
  if (noDownload) return "";
  process.stdout.write(`   ↓ ${url} … `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const hash = createHash("sha256");
  for await (const chunk of res.body) hash.update(chunk);
  const digest = hash.digest("hex");
  process.stdout.write(`${digest.slice(0, 12)}…\n`);
  return digest;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  return res.text();
}
async function fetchJson(url, init) {
  const res = await fetch(url, { redirect: "follow", ...init });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  return res.json();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--no-download") out.noDownload = true;
    else if (a === "--agent") out.agent = argv[++i];
    else if (a === "--platforms") out.platforms = argv[++i];
    else if (a === "--catalog") out.catalog = argv[++i];
    else if (a === "--registry") out.registry = argv[++i];
    else throw new Error(`unexpected arg ${a}`);
  }
  return out;
}
