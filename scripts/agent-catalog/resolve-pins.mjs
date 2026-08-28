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
//       [--no-download]    resolve URLs only, leave sha256 empty (inspection)
//       [--keep-versions]  re-resolve the CURRENTLY pinned versions instead of
//                          upstream latest, so adding a platform to an existing
//                          lockfile cannot drift a pin away from the probe
//                          evidence that validates it
//       [--platforms a,b] [--catalog PATH] [--registry PATH]
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
const keepVersions = Boolean(args.keepVersions);
// Every platform `Platform::registry_key()` (anyharness domains/agents/model.rs)
// can report. A platform missing from this list is a platform whose pin never
// reaches catalog.json, and the runtime installer then fails it closed with
// InstallError::NoPinForPlatform (HTTP 400 AGENT_NO_PIN_FOR_PLATFORM). Narrow
// it with --platforms only for a deliberately partial, inspection-only run.
const DEFAULT_PLATFORMS = [
  "macos_arm64",
  "macos_x64",
  "linux_x64",
  "linux_arm64",
  "windows_x64",
  "windows_arm64",
];
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

// Reuse sha256 already known (from the catalog being processed and/or a
// `--reuse-from` reference, e.g. the previously-shipped lockfile) for unchanged
// URLs, so re-runs and draft→bundled promotion don't re-download every artifact.
const knownSha = new Map();
const knownSize = new Map();
const checksumManifestCache = new Map();
const collectShas = (doc) => {
  for (const agent of doc.agents ?? []) {
    for (const pin of [agent.harness?.native, agent.harness?.agentProcess]) {
      const targetSets = [
        pin?.source?.targets ?? {},
        ...(pin?.source?.companions ?? []).map((companion) => companion.targets ?? {}),
      ];
      for (const t of targetSets.flatMap((set) => Object.values(set))) {
        if (t.url && t.sha256) knownSha.set(t.url, t.sha256);
        if (t.url && Number.isSafeInteger(t.downloadSizeBytes) && t.downloadSizeBytes > 0) {
          knownSize.set(t.url, t.downloadSizeBytes);
        }
      }
    }
  }
};
collectShas(catalog);
if (args.reuseFrom) {
  try {
    collectShas(JSON.parse(readFileSync(resolve(args.reuseFrom), "utf8")));
  } catch (e) {
    console.warn(`! --reuse-from ${args.reuseFrom} not read: ${e.message}`);
  }
}

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
    const { version, source } = await resolveNative(
      agent.kind,
      reg.native.install,
      agent.harness.native.version,
    );
    agent.harness.native.version = version;
    agent.harness.native.source = source;
    console.log(`   native        ${version}  (${source.kind})`);
  } else if (agent.harness.native) {
    // The probe's nativeCli attestation can leak a foreign launcher (e.g. the
    // bundled `claude` binary reported as the nativeCli for cursor/opencode)
    // onto agents that have no native artifact in the registry. Such a pin can
    // never be sourced, so drop it — otherwise the bundled catalog ships a
    // sourceless native entry and stops being a complete lockfile.
    delete agent.harness.native;
    console.log(`   native        (dropped — no registry native artifact)`);
  }

  const ap = await resolveAgentProcess(
    agent.kind,
    reg.agentProcess.install,
    agent.harness.agentProcess.version,
    agent.harness.agentProcess.source,
  );
  if (ap.version) agent.harness.agentProcess.version = ap.version;
  agent.harness.agentProcess.source = ap.source;
  console.log(`   agentProcess  ${ap.version ?? "(kept)"}  (${ap.source.kind})`);
}

writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`\nWrote ${catalogPath}`);

// ── resolvers ────────────────────────────────────────────────────────────────

async function resolveNative(kind, install, currentVersion) {
  if (install.kind === "direct_binary") {
    const version = keepVersions && currentVersion
      ? currentVersion
      : (await fetchText(install.latestVersionUrl)).trim();
    const targets = {};
    for (const [platKey, vendor] of Object.entries(install.platformMap)) {
      if (!platforms.has(platKey)) continue;
      // The artifact filename is per-platform: Windows publishes `claude.exe`
      // where the POSIX targets publish `claude`, so a single hard-coded
      // filename in the template 404s on Windows.
      const binary = install.binaryNameMap?.[platKey] ?? kind;
      const url = install.binaryUrlTemplate
        .replaceAll("{version}", version)
        .replaceAll("{platform}", vendor)
        .replaceAll("{binary}", binary);
      targets[platKey] = withDownloadSize(
        { url, sha256: await shaForDirectBinary(url, version, vendor) },
        url,
      );
    }
    return { version, source: { kind: "binary", targets } };
  }
  if (install.kind === "tarball_release") {
    const release = keepVersions && currentVersion
      ? await githubReleaseByTag(install.versionedUrlTemplate, currentVersion)
      : await githubLatestRelease(install.versionedUrlTemplate);
    const version = release.tag_name;
    // One release, several assets: the CLI archive and each companion sidecar
    // (codex-code-mode-host) resolve from the same tag with the same digest rule.
    const resolveReleaseTargets = async (versionedUrlTemplate, expectedBinaryTemplate) => {
      const targets = {};
      for (const [platKey, target] of Object.entries(install.platformMap)) {
        if (!platforms.has(platKey)) continue;
        const url = versionedUrlTemplate
          .replaceAll("{version}", version)
          .replaceAll("{target}", target);
        const expectedBinary = expectedBinaryTemplate.replaceAll("{target}", target);
        const publishedAsset = release.assets
          ?.find((asset) => asset.browser_download_url === url);
        const publishedDigest = publishedAsset?.digest?.replace(/^sha256:/, "");
        targets[platKey] = withDownloadSize({
          url,
          sha256: await shaForPublished(url, publishedDigest),
          expectedBinary,
        }, url, publishedAsset?.size);
      }
      return targets;
    };
    const targets = await resolveReleaseTargets(
      install.versionedUrlTemplate,
      install.expectedBinaryTemplate,
    );
    const companions = [];
    for (const companion of install.companions ?? []) {
      companions.push({
        name: companion.name,
        targets: await resolveReleaseTargets(
          companion.versionedUrlTemplate,
          companion.expectedBinaryTemplate,
        ),
      });
    }
    // A native CLI is invoked by the adapter, not directly — no ACP launch args.
    const source = { kind: "archive", targets, args: [] };
    if (companions.length > 0) source.companions = companions;
    return { version, source };
  }
  throw new Error(`${kind}: native install kind '${install.kind}' is not resolvable`);
}

async function resolveAgentProcess(kind, install, currentVersion, currentSource) {
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
    // The ACP registry only ever serves `latest`. Under --keep-versions its
    // URLs describe a DIFFERENT release than the one this catalog pins, so
    // adopting them would silently upgrade the agent past the probe evidence
    // that validates it. Keep the existing pin and say so; a version refresh
    // belongs to a probe-backed `make catalog-update`.
    if (keepVersions && currentVersion && entry.version && entry.version !== currentVersion
      && currentSource) {
      console.warn(
        `   ! ${kind}: ACP registry advertises ${entry.version}, catalog pins `
        + `${currentVersion} — keeping the existing pin (platform coverage unchanged)`,
      );
      return { version: currentVersion, source: currentSource };
    }
    if (entry.distribution.npx) {
      const pkg = entry.distribution.npx.package; // already pinned `@scope/pkg@ver`
      return {
        version: entry.version ?? npmVersionOf(pkg) ?? currentVersion,
        source: {
          kind: "npm",
          package: pkg,
          sha256: npmIntegrity(pkg),
          args: entry.distribution.npx.args ?? [],
        },
      };
    }
    if (entry.distribution.binary) {
      const targets = {};
      let args = [];
      for (const [acpKey, target] of Object.entries(entry.distribution.binary)) {
        const ourKey = ACP_PLATFORM_MAP[acpKey];
        if (!ourKey || !platforms.has(ourKey)) continue; // platform we do not ship
        targets[ourKey] = withDownloadSize({
          url: target.archive,
          sha256: await shaForPublished(target.archive, target.sha256),
          expectedBinary: target.cmd,
        }, target.archive, target.size);
        if (target.args) args = target.args; // ACP-mode args (consistent across platforms)
      }
      return { version: entry.version ?? currentVersion, source: { kind: "archive", targets, args } };
    }
    throw new Error(`${kind}: ACP entry '${install.registryId}' has no npx/binary distribution`);
  }
  if (install.kind === "direct_archive") {
    // First-party per-platform tarball pins (no ACP registry, no npm): resolve
    // straight onto the catalog's archive source so the runtime installs it
    // through the existing sha256-verified archive-tree path.
    const targets = {};
    let sawPlatform = false;
    for (const [ourKey, target] of Object.entries(install.platforms ?? {})) {
      if (!platforms.has(ourKey)) continue; // a platform we do not ship
      sawPlatform = true;
      targets[ourKey] = withDownloadSize(
        {
          url: target.url,
          sha256: await shaForPublished(target.url, target.sha256),
          expectedBinary: target.expectedBinary,
        },
        target.url,
        target.size,
      );
    }
    if (!sawPlatform) {
      throw new Error(`${kind}: direct_archive has no platform we ship`);
    }
    return {
      version: currentVersion,
      source: { kind: "archive", targets, args: install.args ?? [] },
    };
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

async function githubLatestRelease(versionedUrlTemplate) {
  // versionedUrlTemplate looks like
  //   https://github.com/<owner>/<repo>/releases/download/{version}/...
  const m = versionedUrlTemplate.match(/github\.com\/([^/]+)\/([^/]+)\/releases/);
  if (!m) throw new Error(`cannot derive GitHub repo from ${versionedUrlTemplate}`);
  const [, owner, repo] = m;
  return fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: { "User-Agent": "proliferate-resolve-pins", Accept: "application/vnd.github+json" },
  });
}

async function githubReleaseByTag(versionedUrlTemplate, tag) {
  const m = versionedUrlTemplate.match(/github\.com\/([^/]+)\/([^/]+)\/releases/);
  if (!m) throw new Error(`cannot derive GitHub repo from ${versionedUrlTemplate}`);
  const [, owner, repo] = m;
  return fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: { "User-Agent": "proliferate-resolve-pins", Accept: "application/vnd.github+json" },
    },
  );
}

async function shaFor(url) {
  if (knownSha.has(url)) return knownSha.get(url);
  if (noDownload) return "";
  process.stdout.write(`   ↓ ${url} … `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    size += chunk.length;
  }
  knownSize.set(url, size);
  const digest = hash.digest("hex");
  process.stdout.write(`${digest.slice(0, 12)}…\n`);
  return digest;
}

async function shaForPublished(url, publishedDigest) {
  if (knownSha.has(url)) return knownSha.get(url);
  if (noDownload) return "";
  if (/^[a-f0-9]{64}$/i.test(publishedDigest ?? "")) {
    console.log(`   ✓ checksum published for ${url}`);
    return publishedDigest.toLowerCase();
  }
  return shaFor(url);
}

async function shaForDirectBinary(url, version, vendorPlatform) {
  if (knownSha.has(url)) return knownSha.get(url);
  if (noDownload) return "";

  // Claude Code's direct-binary channel publishes a versioned manifest beside
  // its per-platform directories. Prefer that provider checksum so a catalog
  // refresh does not download every ~250 MB binary merely to rediscover the
  // digest. Other direct-binary layouts keep the existing download-and-hash
  // behavior as a fail-safe.
  const manifestUrl = new URL("../manifest.json", url).toString();
  try {
    let manifestPromise = checksumManifestCache.get(manifestUrl);
    if (!manifestPromise) {
      manifestPromise = fetchJson(manifestUrl);
      checksumManifestCache.set(manifestUrl, manifestPromise);
    }
    const manifest = await manifestPromise;
    const checksum = manifest?.platforms?.[vendorPlatform]?.checksum;
    const size = manifest?.platforms?.[vendorPlatform]?.size;
    if (manifest?.version === version && /^[a-f0-9]{64}$/i.test(checksum ?? "")) {
      if (Number.isSafeInteger(size) && size > 0) knownSize.set(url, size);
      console.log(`   ✓ ${vendorPlatform} checksum from ${manifestUrl}`);
      return checksum.toLowerCase();
    }
  } catch {
    checksumManifestCache.delete(manifestUrl);
  }
  return shaFor(url);
}

function withDownloadSize(target, url, publishedSize) {
  const size = Number.isSafeInteger(publishedSize) && publishedSize > 0
    ? publishedSize
    : knownSize.get(url);
  return Number.isSafeInteger(size) && size > 0
    ? { ...target, downloadSizeBytes: size }
    : target;
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
    else if (a === "--keep-versions") out.keepVersions = true;
    else if (a === "--agent") out.agent = argv[++i];
    else if (a === "--platforms") out.platforms = argv[++i];
    else if (a === "--catalog") out.catalog = argv[++i];
    else if (a === "--reuse-from") out.reuseFrom = argv[++i];
    else if (a === "--registry") out.registry = argv[++i];
    else throw new Error(`unexpected arg ${a}`);
  }
  return out;
}
