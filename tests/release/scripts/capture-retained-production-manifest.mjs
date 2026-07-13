#!/usr/bin/env node
/**
 * Capture the retained production N-1 manifest for the managed-cloud upgrade
 * world (T4-RUNTIME-1).
 *
 * N-1 is the LAST QUALIFIED PRODUCTION RELEASE, resolved by manifest and digest
 * — never a patch decrement, a rebuild of candidate source, or a rolling
 * `stable` tag. This script snapshots the CURRENTLY-DEPLOYED production release
 * into an immutable RetainedProductionManifest JSON: it reads component versions
 * off the live production `/meta`, and binds the immutable E2B template build id
 * + input hash and template-component digests that the promoting release
 * recorded. It never rebuilds anything and never moves a rolling tag.
 *
 * Secrets: this parses the local env file as DATA (never sources it as shell),
 * ambient environment wins, and prints NAMES only — never values.
 *
 * Usage:
 *   node scripts/capture-retained-production-manifest.mjs \
 *     --out fixtures/retained-production/<version>.json
 *
 * Inputs (env; from the local env file or ambient):
 *   RELEASE_E2E_PROD_API_URL              production API base URL (+ api prefix)
 *   RELEASE_E2E_RETAINED_E2B_TEMPLATE_ID  immutable production template build id
 *   RELEASE_E2E_RETAINED_E2B_INPUT_HASH   that template's complete input hash
 *   RELEASE_E2E_RETAINED_EVIDENCE_REF     evidence ref that promoted this release
 *   RELEASE_E2E_RETAINED_COMPONENT_DIGESTS  JSON {anyharness,worker,supervisor:{locator,digest}}
 *   RELEASE_E2E_RETAINED_AGENT_PINS       JSON map of installed agent pins (optional)
 *
 * The E2B template id/input-hash and component digests are receipts from the
 * release that promoted N-1 (its candidate manifest / E2B dashboard), not values
 * this script invents. A missing required input fails closed with a NAMED error.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const LOCAL_ENV_FILE = resolve(homedir(), ".proliferate-local/dev/release-e2e.env");

/** Parse a dotenv-style file as DATA. Never executed as shell. */
function parseEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function resolveEnv() {
  const fileEnv = parseEnvFile(LOCAL_ENV_FILE);
  // Ambient environment wins over the file.
  return { ...fileEnv, ...process.env };
}

function require_(env, name) {
  const value = env[name];
  if (!value || String(value).trim().length === 0) {
    throw new Error(`missing required input ${name} (set it in ${LOCAL_ENV_FILE} or the environment)`);
  }
  return String(value).trim();
}

function parseArgs(argv) {
  const args = { out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[i + 1];
  }
  if (!args.out) throw new Error("required flag --out <path> is missing");
  return args;
}

function locatorSlot(value) {
  return { available: true, value: { locator: value.locator, digest: value.digest, algorithm: "sha256", sizeBytes: value.sizeBytes ?? null } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = resolveEnv();

  const apiUrl = require_(env, "RELEASE_E2E_PROD_API_URL").replace(/\/+$/, "");
  const templateId = require_(env, "RELEASE_E2E_RETAINED_E2B_TEMPLATE_ID");
  const inputHash = require_(env, "RELEASE_E2E_RETAINED_E2B_INPUT_HASH");
  const evidenceRef = require_(env, "RELEASE_E2E_RETAINED_EVIDENCE_REF");
  const componentDigests = JSON.parse(require_(env, "RELEASE_E2E_RETAINED_COMPONENT_DIGESTS"));
  const agentPins = env.RELEASE_E2E_RETAINED_AGENT_PINS ? JSON.parse(env.RELEASE_E2E_RETAINED_AGENT_PINS) : null;

  if (/latest|rolling|stable/i.test(templateId)) {
    throw new Error(`RELEASE_E2E_RETAINED_E2B_TEMPLATE_ID "${templateId}" looks like a rolling tag; capture the immutable build id`);
  }

  // Read the live production component versions off /meta (read-only).
  const metaResp = await fetch(`${apiUrl}/meta`, { method: "GET" });
  if (!metaResp.ok) {
    throw new Error(`GET ${apiUrl}/meta -> ${metaResp.status}; cannot read production version identities`);
  }
  const meta = await metaResp.json();
  const serverVersion = meta.serverVersion ?? meta.version ?? null;
  const runtimeVersion = meta.runtimeVersion ?? null;
  const workerVersion = meta.workerVersion ?? null;
  const desktopVersion = meta.desktopVersion ?? null;
  if (!serverVersion) {
    throw new Error(`production /meta did not report a server version; got keys: ${Object.keys(meta).join(",")}`);
  }

  const unavailable = (reason) => ({ available: false, reason });
  const strSlot = (v, reason) => (v ? { available: true, value: v } : unavailable(reason));

  const manifest = {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: meta.sourceSha ?? meta.gitSha ?? serverVersion,
    productVersion: serverVersion,
    qualificationEvidenceRef: evidenceRef,
    // Desktop artifacts are not this world's concern; T4-DESKTOP-1 captures them.
    desktopApp: unavailable("Desktop upgrade world owns Desktop artifacts"),
    desktopUpdater: unavailable("Desktop upgrade world owns Desktop artifacts"),
    desktopUpdaterTrustIdentity: unavailable("Desktop upgrade world owns Desktop trust identity"),
    bundledAnyharnessVersion: strSlot(runtimeVersion, "production /meta did not report runtimeVersion"),
    bundledWorkerVersion: strSlot(workerVersion, "production /meta did not report workerVersion"),
    seedHash: unavailable("not exposed on /meta; bind from the promoting release if a seed row is added"),
    catalogHash: strSlot(meta.catalogHash, "production /meta did not report catalogHash"),
    registryHash: strSlot(meta.registryHash, "production /meta did not report registryHash"),
    e2bTemplate: { available: true, value: { templateId, inputHash } },
    templateComponents: {
      available: true,
      value: {
        anyharness: locatorSlot(componentDigests.anyharness).value,
        worker: locatorSlot(componentDigests.worker).value,
        supervisor: locatorSlot(componentDigests.supervisor).value,
      },
    },
    installedAgentPins: agentPins
      ? { available: true, value: agentPins }
      : unavailable("provide RELEASE_E2E_RETAINED_AGENT_PINS from the promoting release's seed pins"),
  };

  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  // Names only, never values.
  console.log(
    `captured retained-production manifest -> ${outPath}\n` +
      `  productVersion=${serverVersion} runtime=${runtimeVersion ?? "(unset)"} worker=${workerVersion ?? "(unset)"} desktop=${desktopVersion ?? "(unset)"}\n` +
      `  e2bTemplate=${templateId} (immutable) evidenceRef bound`,
  );
}

main().catch((error) => {
  console.error(`capture-retained-production-manifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
