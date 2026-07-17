import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The retained-release receipt: the exact immutable production N-1 artifacts a
 * Tier 4 update proof starts FROM (tier-4-scenario-contract.md "Artifact
 * Identity"; frozen spec "Retain Exact Production Artifacts for Tier 4").
 * The candidate side has `CandidateBuildMapV1` (build-map.ts); this is its
 * retained-production counterpart.
 *
 * A receipt is produced at release time (or, for the one-time bootstrap
 * release, reconstructed only after independently verifying every artifact —
 * see cli/create-retained-release-receipt.ts) and committed under
 * `tests/release/retained-releases/`. The repository is the durable immutable
 * store for the receipt itself; the artifact BYTES stay in their durable
 * stores (downloads CDN, GitHub release assets, GHCR, E2B) and are re-verified
 * by hash on every materialization.
 *
 * The canonical release-manifest schema
 * (specs/codebase/systems/engineering/delivery/release-manifest.schema.json)
 * has no publisher today — nothing computes its `artifactSetDigest` or writes
 * `release-manifest.json` (specs/developing/deploying/releases.md). Ownership
 * therefore does not fit extending it; this receipt is the narrowly scoped
 * qualification-owned contract, keyed by release tag + source SHA.
 */

export type RetainedQualificationState = "bootstrap_unqualified" | "qualified";

export type RetainedTarget = "desktop" | "managed-runtime" | "self-host";

export const RETAINED_TARGETS: readonly RetainedTarget[] = [
  "desktop",
  "managed-runtime",
  "self-host",
];

/** Desktop platforms production actually publishes (release-desktop.yml). */
export type RetainedDesktopPlatform = "darwin-aarch64" | "darwin-x86_64";

export interface RetainedDesktopPackageV1 {
  platform: RetainedDesktopPlatform;
  /** Immutable HTTPS locator embedding the exact version (never `latest`). */
  immutable_locator: string;
  /** Lowercase 64-hex digest of the package bytes. */
  sha256: string;
  /** Locator of the Tauri updater signature (.sig) for this package. */
  signature_locator: string;
  sha256_signature: string;
}

export interface RetainedReleaseReceiptV1 {
  schema_version: 1;
  kind: "proliferate.retained-release";
  release: {
    /** Human-facing release id, e.g. `v0.3.38` — a lookup key, not identity. */
    release_id: string;
    /** The product tag, e.g. `proliferate-v0.3.38`. */
    release_tag: string;
    /** Lowercase 40-hex source SHA all product tags of this release point at. */
    source_sha: string;
    /** ISO-8601 publication instant (the versioned updater snapshot's pub_date). */
    published_at: string;
    qualification_state: RetainedQualificationState;
    /**
     * Required when `qualified`; forbidden when `bootstrap_unqualified` (the
     * bootstrap release explicitly has no qualification evidence and must
     * never be retrofitted with fake historical evidence).
     */
    qualification_evidence: {
      report_sha256: string;
      immutable_locator: string;
    } | null;
  };
  desktop: {
    version: string;
    packages: RetainedDesktopPackageV1[];
    /**
     * The Tauri updater trust identity the retained app verifies updates with
     * (minisign public key, base64 — non-secret, baked into the app).
     */
    updater_pubkey: string;
    embedded_anyharness_version: string;
  };
  managed_runtime: {
    /** E2B template family, e.g. `pablo-5391/proliferate-runtime-cloud`. */
    template_family: string;
    /** Immutable E2B template id. */
    immutable_template_id: string;
    /** Immutable E2B build id the mutable `production` alias resolved to. */
    template_build_id: string;
    /** Immutable source tag, `sha-<first 12 hex of source_sha>`. */
    source_tag: string;
    /**
     * Complete template input hash. E2B exposes no input hash and no repo
     * code has ever recorded one, so the bootstrap receipt truthfully carries
     * null (disclosed unavailable historical artifact). Receipts in state
     * `qualified` must carry a real hash — null fails validation.
     */
    input_hash: string | null;
    anyharness_version: string;
    worker_version: string;
    supervisor_version: string;
    /** SHA-256 of catalogs/agents/catalog.json at source_sha (native CLI + ACP pins). */
    harness_catalog_digest: string;
    /** SHA-256 of catalogs/agents/registry.json at source_sha (trusted registry). */
    harness_registry_digest: string;
  };
  self_host: {
    /**
     * The self-host surface version actually in production for this release.
     * May be older than release_id: self-host releases are surface-scoped
     * (server-v* tags), and a hotfix that does not ship the server surface
     * leaves production self-host at the prior server release.
     */
    version: string;
    /** The server release tag the bundle belongs to, e.g. `server-v0.3.35`. */
    release_tag: string;
    deploy_bundle_locator: string;
    deploy_bundle_sha256: string;
    /** OCI reference pinned by digest, e.g. `ghcr.io/...@sha256:...`. */
    server_image_digest: string;
  };
  /**
   * SHA-256 of the canonical (recursively key-sorted, no-whitespace) JSON of
   * the receipt with this field removed. Recomputed on every load.
   */
  artifact_set_digest: string;
}

/** The bounded projection allowed into aggregate qualification evidence. */
export interface RetainedReleaseEvidenceV1 {
  kind: "retained_release";
  release_id: string;
  source_sha: string;
  qualification_state: RetainedQualificationState;
  receipt_sha256: string;
  artifact_set_digest: string;
  selected_targets: string[];
  materialized_hashes: Array<{
    artifact: string;
    digest: string;
  }>;
}

/**
 * Invalid receipt / policy / integrity input: consumers exit before any world
 * side effect. Messages never embed raw receipt JSON, locator query strings,
 * or provider responses.
 */
export class RetainedReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetainedReleaseError";
  }
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_ID_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const SOURCE_TAG_PATTERN = /^sha-[0-9a-f]{12}$/;
const OCI_DIGEST_REF_PATTERN = /^[a-z0-9.-]+\/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/;
const DESKTOP_PLATFORMS: readonly RetainedDesktopPlatform[] = [
  "darwin-aarch64",
  "darwin-x86_64",
];
// Query parameters that mark a presigned/expiring URL. An expiring locator can
// never satisfy the retention promise, even while it still resolves.
const EXPIRING_QUERY_PATTERN = /(^|[?&])(x-amz-[a-z-]+|signature|expires|token|sig|se|sp|sv)=/i;
// Rolling aliases that are forbidden as the identifying final path segment.
const MUTABLE_TERMINAL_SEGMENTS = new Set(["latest", "latest.json", "stable", "production", "staging"]);

/**
 * An immutable retained locator must be HTTPS (or an OCI digest reference),
 * non-expiring, non-local, and must embed content identity — the exact
 * version, the source sha12, or an @sha256 digest. A rolling alias may appear
 * as an interior path segment (the CDN tree is `desktop/stable/<file>`), but
 * never as the identifying terminal segment, and never as the only identity.
 */
export function assertImmutableLocator(
  locator: string,
  where: string,
  identityTokens: readonly string[],
): void {
  if (typeof locator !== "string" || locator.trim().length === 0) {
    throw new RetainedReleaseError(`${where} locator is missing.`);
  }
  if (OCI_DIGEST_REF_PATTERN.test(locator)) {
    return; // digest-pinned OCI reference: immutable by construction.
  }
  if (locator.startsWith("file://") || locator.startsWith("/") || locator.startsWith("./") || locator.startsWith("~")) {
    throw new RetainedReleaseError(
      `${where} locator is a local filesystem path; a persisted receipt must use durable immutable locators.`,
    );
  }
  let url: URL;
  try {
    url = new URL(locator);
  } catch {
    throw new RetainedReleaseError(`${where} locator is not a valid URL or OCI digest reference.`);
  }
  if (url.protocol !== "https:") {
    throw new RetainedReleaseError(`${where} locator must be https (got ${url.protocol.replace(":", "")}).`);
  }
  if (EXPIRING_QUERY_PATTERN.test(url.search)) {
    throw new RetainedReleaseError(
      `${where} locator carries presigned/expiring query parameters; expiring URLs are forbidden in receipts.`,
    );
  }
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const terminal = segments.at(-1)?.toLowerCase() ?? "";
  if (MUTABLE_TERMINAL_SEGMENTS.has(terminal)) {
    throw new RetainedReleaseError(
      `${where} locator resolves a mutable alias ("${terminal}"); a rolling pointer cannot identify retained bytes even while it currently resolves.`,
    );
  }
  const haystack = locator.toLowerCase();
  const identified = identityTokens.some(
    (token) => token.length > 0 && haystack.includes(token.toLowerCase()),
  );
  if (!identified) {
    throw new RetainedReleaseError(
      `${where} locator embeds no content identity (expected the exact version, source sha, or a digest).`,
    );
  }
}

/** Recursively key-sorted, whitespace-free JSON — the digest normalization. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256OfText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The artifact-set digest: canonical receipt content minus the digest field. */
export function computeArtifactSetDigest(
  receipt: Omit<RetainedReleaseReceiptV1, "artifact_set_digest">,
): string {
  const { release, desktop, managed_runtime, self_host, schema_version, kind } = receipt;
  return sha256OfText(
    canonicalJson({ schema_version, kind, release, desktop, managed_runtime, self_host }),
  );
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RetainedReleaseError(
      `Retained-release ${where} has undeclared field(s): ${unknown.join(", ")}.`,
    );
  }
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RetainedReleaseError(`Retained-release ${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, where: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RetainedReleaseError(`Retained-release ${where} is missing or empty.`);
  }
  if (pattern && !pattern.test(value)) {
    throw new RetainedReleaseError(`Retained-release ${where} is malformed.`);
  }
  return value;
}

/**
 * Strict structural validation of a parsed receipt, independent of the
 * filesystem and providers. Unknown fields, unknown schema versions, missing
 * targets, malformed identities, mutable/expiring/local locators, and an
 * artifact-set digest that does not recompute all reject here — before any
 * consumer side effect.
 */
export function validateRetainedReleaseReceiptShape(parsed: unknown): RetainedReleaseReceiptV1 {
  const root = requireObject(parsed, "receipt");
  rejectUnknownKeys(
    root,
    ["schema_version", "kind", "release", "desktop", "managed_runtime", "self_host", "artifact_set_digest"],
    "receipt",
  );
  if (root.schema_version !== 1) {
    throw new RetainedReleaseError("Unsupported retained-release receipt schema_version.");
  }
  if (root.kind !== "proliferate.retained-release") {
    throw new RetainedReleaseError("Unsupported retained-release receipt kind.");
  }

  const releaseRaw = requireObject(root.release, "release");
  rejectUnknownKeys(
    releaseRaw,
    ["release_id", "release_tag", "source_sha", "published_at", "qualification_state", "qualification_evidence"],
    "release",
  );
  const releaseId = requireString(releaseRaw.release_id, "release.release_id", RELEASE_ID_PATTERN);
  const releaseTag = requireString(releaseRaw.release_tag, "release.release_tag");
  const sourceSha = requireString(releaseRaw.source_sha, "release.source_sha", FULL_SHA_PATTERN);
  if (releaseTag !== `proliferate-${releaseId}`) {
    throw new RetainedReleaseError(
      `Retained-release release_tag "${releaseTag}" does not correspond to release_id "${releaseId}".`,
    );
  }
  const publishedAt = requireString(releaseRaw.published_at, "release.published_at");
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new RetainedReleaseError("Retained-release release.published_at is not a valid instant.");
  }
  const state = releaseRaw.qualification_state;
  if (state !== "bootstrap_unqualified" && state !== "qualified") {
    throw new RetainedReleaseError("Retained-release release.qualification_state is unknown.");
  }
  let evidence: RetainedReleaseReceiptV1["release"]["qualification_evidence"] = null;
  if (state === "qualified") {
    const evidenceRaw = requireObject(
      releaseRaw.qualification_evidence,
      "release.qualification_evidence (required for a qualified receipt)",
    );
    rejectUnknownKeys(evidenceRaw, ["report_sha256", "immutable_locator"], "release.qualification_evidence");
    const reportSha = requireString(
      evidenceRaw.report_sha256,
      "release.qualification_evidence.report_sha256",
      SHA256_PATTERN,
    );
    const evidenceLocator = requireString(
      evidenceRaw.immutable_locator,
      "release.qualification_evidence.immutable_locator",
    );
    assertImmutableLocator(evidenceLocator, "release.qualification_evidence", [reportSha, releaseId, sourceSha.slice(0, 12)]);
    evidence = { report_sha256: reportSha, immutable_locator: evidenceLocator };
  } else if (releaseRaw.qualification_evidence != null) {
    throw new RetainedReleaseError(
      "A bootstrap_unqualified receipt must not carry qualification evidence; do not retrofit fake historical qualification.",
    );
  }

  const releaseVersion = releaseId.slice(1);
  const sha12 = sourceSha.slice(0, 12);

  const desktopRaw = requireObject(root.desktop, "desktop");
  rejectUnknownKeys(
    desktopRaw,
    ["version", "packages", "updater_pubkey", "embedded_anyharness_version"],
    "desktop",
  );
  const desktopVersion = requireString(desktopRaw.version, "desktop.version", VERSION_PATTERN);
  if (desktopVersion !== releaseVersion) {
    throw new RetainedReleaseError(
      `Retained-release desktop.version ${desktopVersion} does not match release ${releaseVersion}.`,
    );
  }
  const updaterPubkey = requireString(desktopRaw.updater_pubkey, "desktop.updater_pubkey");
  const embeddedAnyharness = requireString(
    desktopRaw.embedded_anyharness_version,
    "desktop.embedded_anyharness_version",
    VERSION_PATTERN,
  );
  if (!Array.isArray(desktopRaw.packages) || desktopRaw.packages.length === 0) {
    throw new RetainedReleaseError("Retained-release desktop.packages must be a non-empty array.");
  }
  const seenPlatforms = new Set<string>();
  const packages = desktopRaw.packages.map((entry, index) => {
    const pkg = requireObject(entry, `desktop.packages[${index}]`);
    rejectUnknownKeys(
      pkg,
      ["platform", "immutable_locator", "sha256", "signature_locator", "sha256_signature"],
      `desktop.packages[${index}]`,
    );
    const platform = pkg.platform;
    if (typeof platform !== "string" || !DESKTOP_PLATFORMS.includes(platform as RetainedDesktopPlatform)) {
      throw new RetainedReleaseError(`desktop.packages[${index}].platform is unsupported.`);
    }
    if (seenPlatforms.has(platform)) {
      throw new RetainedReleaseError(`desktop.packages has duplicate platform "${platform}".`);
    }
    seenPlatforms.add(platform);
    const locator = requireString(pkg.immutable_locator, `desktop.packages[${index}].immutable_locator`);
    assertImmutableLocator(locator, `desktop.packages[${index}]`, [releaseVersion, sha12]);
    const sha256 = requireString(pkg.sha256, `desktop.packages[${index}].sha256`, SHA256_PATTERN);
    const signatureLocator = requireString(
      pkg.signature_locator,
      `desktop.packages[${index}].signature_locator`,
    );
    assertImmutableLocator(signatureLocator, `desktop.packages[${index}].signature`, [releaseVersion, sha12]);
    const signatureSha = requireString(
      pkg.sha256_signature,
      `desktop.packages[${index}].sha256_signature`,
      SHA256_PATTERN,
    );
    return {
      platform: platform as RetainedDesktopPlatform,
      immutable_locator: locator,
      sha256,
      signature_locator: signatureLocator,
      sha256_signature: signatureSha,
    };
  });
  for (const required of DESKTOP_PLATFORMS) {
    if (!seenPlatforms.has(required)) {
      throw new RetainedReleaseError(`desktop.packages is missing supported platform "${required}".`);
    }
  }

  const runtimeRaw = requireObject(root.managed_runtime, "managed_runtime");
  rejectUnknownKeys(
    runtimeRaw,
    [
      "template_family",
      "immutable_template_id",
      "template_build_id",
      "source_tag",
      "input_hash",
      "anyharness_version",
      "worker_version",
      "supervisor_version",
      "harness_catalog_digest",
      "harness_registry_digest",
    ],
    "managed_runtime",
  );
  const templateFamily = requireString(runtimeRaw.template_family, "managed_runtime.template_family");
  const templateId = requireString(runtimeRaw.immutable_template_id, "managed_runtime.immutable_template_id");
  const buildId = requireString(runtimeRaw.template_build_id, "managed_runtime.template_build_id");
  const sourceTag = requireString(runtimeRaw.source_tag, "managed_runtime.source_tag", SOURCE_TAG_PATTERN);
  if (sourceTag !== `sha-${sha12}`) {
    throw new RetainedReleaseError(
      `managed_runtime.source_tag "${sourceTag}" does not match the release source SHA (expected sha-${sha12}).`,
    );
  }
  let inputHash: string | null = null;
  if (runtimeRaw.input_hash !== null) {
    inputHash = requireString(runtimeRaw.input_hash, "managed_runtime.input_hash", SHA256_PATTERN);
  } else if (state === "qualified") {
    throw new RetainedReleaseError(
      "A qualified receipt must carry the complete E2B template input hash; null is allowed only for the disclosed bootstrap receipt.",
    );
  }
  const anyharnessVersion = requireString(
    runtimeRaw.anyharness_version,
    "managed_runtime.anyharness_version",
    VERSION_PATTERN,
  );
  const workerVersion = requireString(
    runtimeRaw.worker_version,
    "managed_runtime.worker_version",
    VERSION_PATTERN,
  );
  const supervisorVersion = requireString(
    runtimeRaw.supervisor_version,
    "managed_runtime.supervisor_version",
    VERSION_PATTERN,
  );
  const catalogDigest = requireString(
    runtimeRaw.harness_catalog_digest,
    "managed_runtime.harness_catalog_digest",
    SHA256_PATTERN,
  );
  const registryDigest = requireString(
    runtimeRaw.harness_registry_digest,
    "managed_runtime.harness_registry_digest",
    SHA256_PATTERN,
  );

  const selfHostRaw = requireObject(root.self_host, "self_host");
  rejectUnknownKeys(
    selfHostRaw,
    ["version", "release_tag", "deploy_bundle_locator", "deploy_bundle_sha256", "server_image_digest"],
    "self_host",
  );
  const selfHostVersion = requireString(selfHostRaw.version, "self_host.version", VERSION_PATTERN);
  const selfHostTag = requireString(selfHostRaw.release_tag, "self_host.release_tag");
  if (selfHostTag !== `server-v${selfHostVersion}`) {
    throw new RetainedReleaseError(
      `self_host.release_tag "${selfHostTag}" does not correspond to self_host.version "${selfHostVersion}".`,
    );
  }
  const bundleLocator = requireString(selfHostRaw.deploy_bundle_locator, "self_host.deploy_bundle_locator");
  assertImmutableLocator(bundleLocator, "self_host.deploy_bundle", [selfHostVersion, selfHostTag]);
  const bundleSha = requireString(
    selfHostRaw.deploy_bundle_sha256,
    "self_host.deploy_bundle_sha256",
    SHA256_PATTERN,
  );
  const imageDigest = requireString(selfHostRaw.server_image_digest, "self_host.server_image_digest");
  if (!OCI_DIGEST_REF_PATTERN.test(imageDigest)) {
    throw new RetainedReleaseError(
      "self_host.server_image_digest must be an OCI reference pinned by @sha256 digest (a mutable tag alone cannot identify retained bytes).",
    );
  }

  const declaredDigest = requireString(root.artifact_set_digest, "artifact_set_digest", SHA256_PATTERN);
  const receipt: RetainedReleaseReceiptV1 = {
    schema_version: 1,
    kind: "proliferate.retained-release",
    release: {
      release_id: releaseId,
      release_tag: releaseTag,
      source_sha: sourceSha,
      published_at: publishedAt,
      qualification_state: state,
      qualification_evidence: evidence,
    },
    desktop: {
      version: desktopVersion,
      packages,
      updater_pubkey: updaterPubkey,
      embedded_anyharness_version: embeddedAnyharness,
    },
    managed_runtime: {
      template_family: templateFamily,
      immutable_template_id: templateId,
      template_build_id: buildId,
      source_tag: sourceTag,
      input_hash: inputHash,
      anyharness_version: anyharnessVersion,
      worker_version: workerVersion,
      supervisor_version: supervisorVersion,
      harness_catalog_digest: catalogDigest,
      harness_registry_digest: registryDigest,
    },
    self_host: {
      version: selfHostVersion,
      release_tag: selfHostTag,
      deploy_bundle_locator: bundleLocator,
      deploy_bundle_sha256: bundleSha,
      server_image_digest: imageDigest,
    },
    artifact_set_digest: declaredDigest,
  };

  const recomputed = computeArtifactSetDigest(receipt);
  if (recomputed !== declaredDigest) {
    throw new RetainedReleaseError(
      `Retained-release artifact_set_digest does not recompute from normalized content ` +
        `(declared ${declaredDigest}, recomputed ${recomputed}).`,
    );
  }

  return receipt;
}

/** Policy inputs for selecting a retained release as the Tier 4 N-1. */
export interface RetainedReleasePolicy {
  /** Targets this run consumes; each must be completely present (all are, structurally). */
  requiredTargets: readonly RetainedTarget[];
  /**
   * The candidate N source SHA. N-1 and N must not accidentally be the same
   * release/artifact set.
   */
  currentCandidateSourceSha?: string;
  /**
   * True when any `qualified` production receipt exists (see the committed
   * index). Once one exists, selecting a bootstrap receipt fails closed —
   * the bootstrap exception is one-time by founder ruling.
   */
  qualifiedReceiptExists: boolean;
}

/**
 * Policy validation, run after shape validation and before any world side
 * effect (starting Desktop, E2B, EC2, or a candidate API).
 */
export function validateRetainedRelease(
  receipt: RetainedReleaseReceiptV1,
  policy: RetainedReleasePolicy,
): void {
  for (const target of policy.requiredTargets) {
    if (!RETAINED_TARGETS.includes(target)) {
      throw new RetainedReleaseError(`Unknown required retained target "${target}".`);
    }
  }
  if (
    receipt.release.qualification_state === "bootstrap_unqualified" &&
    policy.qualifiedReceiptExists
  ) {
    throw new RetainedReleaseError(
      `Retained release ${receipt.release.release_id} is bootstrap_unqualified, but a qualified production ` +
        `receipt already exists; the one-time bootstrap exception no longer applies. Select the last ` +
        `qualified production receipt.`,
    );
  }
  if (
    policy.currentCandidateSourceSha &&
    policy.currentCandidateSourceSha === receipt.release.source_sha
  ) {
    throw new RetainedReleaseError(
      `Retained N-1 release ${receipt.release.release_id} has the same source SHA as candidate N ` +
        `(${receipt.release.source_sha}); an update proof from a release to itself proves nothing.`,
    );
  }
}

/**
 * Loads, shape-validates, and digest-checks a receipt file. `receiptSha256`
 * is the digest of the exact file bytes — the identity recorded in evidence.
 */
export function loadRetainedReleaseReceipt(receiptPath: string): {
  receipt: RetainedReleaseReceiptV1;
  receiptSha256: string;
} {
  let raw: string;
  try {
    raw = readFileSync(receiptPath, "utf8");
  } catch (error) {
    throw new RetainedReleaseError(
      `Retained-release receipt is not readable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RetainedReleaseError("Retained-release receipt is not valid JSON.");
  }
  return {
    receipt: validateRetainedReleaseReceiptShape(parsed),
    receiptSha256: sha256OfText(raw),
  };
}

/** The committed append-only index of retained receipts (the retention roots). */
export interface RetainedReleaseIndexV1 {
  schema_version: 1;
  kind: "proliferate.retained-release-index";
  receipts: Array<{
    release_id: string;
    source_sha: string;
    qualification_state: RetainedQualificationState;
    /** Repository path of the receipt file, relative to the index directory. */
    receipt_path: string;
    /** SHA-256 of the exact receipt file bytes. */
    receipt_sha256: string;
  }>;
}

export const RETAINED_RELEASES_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "retained-releases",
);
export const RETAINED_RELEASE_INDEX_PATH = path.join(RETAINED_RELEASES_DIR, "index.json");

export function loadRetainedReleaseIndex(
  indexPath: string = RETAINED_RELEASE_INDEX_PATH,
): RetainedReleaseIndexV1 {
  let raw: string;
  try {
    raw = readFileSync(indexPath, "utf8");
  } catch (error) {
    throw new RetainedReleaseError(
      `Retained-release index is not readable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RetainedReleaseError("Retained-release index is not valid JSON.");
  }
  const root = requireObject(parsed, "index");
  rejectUnknownKeys(root, ["schema_version", "kind", "receipts"], "index");
  if (root.schema_version !== 1 || root.kind !== "proliferate.retained-release-index") {
    throw new RetainedReleaseError("Unsupported retained-release index schema/kind.");
  }
  if (!Array.isArray(root.receipts)) {
    throw new RetainedReleaseError("Retained-release index receipts must be an array.");
  }
  const receipts = root.receipts.map((entry, index) => {
    const record = requireObject(entry, `index.receipts[${index}]`);
    rejectUnknownKeys(
      record,
      ["release_id", "source_sha", "qualification_state", "receipt_path", "receipt_sha256"],
      `index.receipts[${index}]`,
    );
    const state = record.qualification_state;
    if (state !== "bootstrap_unqualified" && state !== "qualified") {
      throw new RetainedReleaseError(`index.receipts[${index}].qualification_state is unknown.`);
    }
    return {
      release_id: requireString(record.release_id, `index.receipts[${index}].release_id`, RELEASE_ID_PATTERN),
      source_sha: requireString(record.source_sha, `index.receipts[${index}].source_sha`, FULL_SHA_PATTERN),
      qualification_state: state as RetainedQualificationState,
      receipt_path: requireString(record.receipt_path, `index.receipts[${index}].receipt_path`),
      receipt_sha256: requireString(record.receipt_sha256, `index.receipts[${index}].receipt_sha256`, SHA256_PATTERN),
    };
  });
  return { schema_version: 1, kind: "proliferate.retained-release-index", receipts };
}

export function qualifiedReceiptExists(index: RetainedReleaseIndexV1): boolean {
  return index.receipts.some((entry) => entry.qualification_state === "qualified");
}

/** Optional live drift checks against provider metadata (read-only hooks). */
export interface RetainedReleaseLiveChecks {
  /** Resolves a template family's tags to `{ tag, buildId }` pairs (E2B read-only). */
  resolveE2bTags?: (templateFamily: string) => Promise<Array<{ tag: string; buildId: string }>>;
  /** Resolves an OCI reference (without digest) to its current digest for the recorded tag. */
  resolveOciDigest?: (reference: string) => Promise<string>;
  /** Resolves the provider's template input hash, when one exists. */
  resolveE2bInputHash?: (templateFamily: string, buildId: string) => Promise<string | null>;
  /** Expected component versions/digests observed inside the template. */
  expectedComponents?: {
    anyharness_version?: string;
    worker_version?: string;
    supervisor_version?: string;
    harness_catalog_digest?: string;
    harness_registry_digest?: string;
  };
}

/**
 * Verifies the receipt's provider identities against live read-only metadata.
 * The receipt stays tied to its immutable ids: if the mutable `production`
 * alias moved to a different build, that is promotion drift flagged
 * separately by the caller — but the recorded immutable source tag must still
 * resolve to the recorded build id, and observed component identities must
 * agree with the receipt.
 */
export async function verifyRetainedReleaseLive(
  receipt: RetainedReleaseReceiptV1,
  checks: RetainedReleaseLiveChecks,
): Promise<void> {
  const runtime = receipt.managed_runtime;
  if (checks.resolveE2bTags) {
    const tags = await checks.resolveE2bTags(runtime.template_family);
    const sourceTag = tags.find((entry) => entry.tag === runtime.source_tag);
    if (!sourceTag) {
      throw new RetainedReleaseError(
        `E2B immutable source tag ${runtime.source_tag} no longer resolves on ${runtime.template_family}; ` +
          `the retained template build cannot be identified.`,
      );
    }
    if (sourceTag.buildId !== runtime.template_build_id) {
      throw new RetainedReleaseError(
        `E2B source tag ${runtime.source_tag} resolves to build ${sourceTag.buildId}, but the receipt ` +
          `records ${runtime.template_build_id}; template build drift.`,
      );
    }
  }
  if (checks.resolveE2bInputHash && runtime.input_hash !== null) {
    const observed = await checks.resolveE2bInputHash(runtime.template_family, runtime.template_build_id);
    if (observed !== null && observed !== runtime.input_hash) {
      throw new RetainedReleaseError(
        `E2B template input hash drift (receipt ${runtime.input_hash}, provider ${observed}).`,
      );
    }
  }
  if (checks.resolveOciDigest) {
    const [reference, declaredDigest] = receipt.self_host.server_image_digest.split("@");
    const observed = await checks.resolveOciDigest(reference);
    if (observed !== declaredDigest) {
      throw new RetainedReleaseError(
        `Self-host server image digest drift (receipt ${declaredDigest}, registry ${observed}).`,
      );
    }
  }
  const expected = checks.expectedComponents;
  if (expected) {
    const comparisons: Array<[string, string | undefined, string]> = [
      ["anyharness_version", expected.anyharness_version, runtime.anyharness_version],
      ["worker_version", expected.worker_version, runtime.worker_version],
      ["supervisor_version", expected.supervisor_version, runtime.supervisor_version],
      ["harness_catalog_digest", expected.harness_catalog_digest, runtime.harness_catalog_digest],
      ["harness_registry_digest", expected.harness_registry_digest, runtime.harness_registry_digest],
    ];
    for (const [field, observed, declared] of comparisons) {
      if (observed !== undefined && observed !== declared) {
        throw new RetainedReleaseError(
          `Retained component drift on managed_runtime.${field} (receipt ${declared}, observed ${observed}).`,
        );
      }
    }
  }
}

/**
 * The only projection of a retained release allowed into aggregate evidence:
 * bounded identities and hashes. Never raw locator query strings, provider
 * responses, credentials, or the full receipt body.
 */
export function toRetainedReleaseEvidence(
  receipt: RetainedReleaseReceiptV1,
  receiptSha256: string,
  selectedTargets: readonly RetainedTarget[],
  materializedHashes: Array<{ artifact: string; digest: string }>,
): RetainedReleaseEvidenceV1 {
  return {
    kind: "retained_release",
    release_id: receipt.release.release_id,
    source_sha: receipt.release.source_sha,
    qualification_state: receipt.release.qualification_state,
    receipt_sha256: receiptSha256,
    artifact_set_digest: receipt.artifact_set_digest,
    selected_targets: [...selectedTargets],
    materialized_hashes: materializedHashes.map((entry) => ({
      artifact: entry.artifact,
      digest: entry.digest,
    })),
  };
}
