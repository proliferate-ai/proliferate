/**
 * Candidate and retained-production artifact manifests.
 *
 * Frozen contract (specs/developing/testing/release-worlds-and-fixtures.md
 * "Candidate Artifacts"). Both manifests are versioned machine contracts.
 * Every available slot carries an immutable locator plus the digest needed to
 * verify downloaded bytes. Rolling references ("latest", unverified "stable")
 * can never satisfy a slot. N-1 is resolved from the retained manifest, never
 * inferred by patch arithmetic or rebuilt from candidate source.
 */

/** A verifiable, immutable artifact reference. */
export interface ArtifactLocator {
  /** Immutable URL/S3 key/path — never a rolling tag. */
  readonly locator: string;
  /** Hex digest of the artifact bytes. */
  readonly digest: string;
  /** Digest algorithm; sha256 unless a provider dictates otherwise. */
  readonly algorithm: "sha256";
  /** Byte size when known; used as a cheap pre-verification guard. */
  readonly sizeBytes: number | null;
}

/** An E2B template slot: immutable template ID plus complete input hash. */
export interface TemplateSlot {
  /** Immutable template id (e.g. the sha-tagged build id) — never a rolling tag. */
  readonly templateId: string;
  /** Content hash over every template input (runtime binary, Dockerfile, pins…). */
  readonly inputHash: string;
}

/**
 * A slot may be explicitly unavailable while the foundation is under
 * construction. Strict execution rejects an unavailable slot required by a
 * selected world; it is never silently skipped.
 */
export type Slot<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false; readonly reason: string };

export type PlatformKey = "darwin-aarch64" | "darwin-x86_64" | "linux-x86_64" | "linux-aarch64";

export interface CandidateManifest {
  readonly schemaVersion: 1;
  readonly kind: "candidate";
  readonly sourceSha: string;
  /** Hash of the source tree contents, distinct from the git SHA. */
  readonly sourceContentHash: string;
  readonly serverImage: Slot<ArtifactLocator>;
  readonly webBuild: Slot<ArtifactLocator>;
  readonly desktopApp: Slot<ArtifactLocator>;
  /** Signed Tauri updater archive + signature identity. */
  readonly desktopUpdater: Slot<ArtifactLocator & { readonly signature: string }>;
  readonly anyharness: Partial<Readonly<Record<PlatformKey, Slot<ArtifactLocator>>>>;
  readonly worker: Partial<Readonly<Record<PlatformKey, Slot<ArtifactLocator>>>>;
  readonly supervisor: Partial<Readonly<Record<PlatformKey, Slot<ArtifactLocator>>>>;
  readonly catalogHash: Slot<string>;
  readonly registryHash: Slot<string>;
  readonly e2bTemplate: Slot<TemplateSlot>;
  readonly selfHostBundle: Slot<ArtifactLocator>;
  readonly litellm: Slot<{ readonly image: ArtifactLocator; readonly configHash: string }>;
}

/**
 * Receipt for the actual production N-1 artifacts of the last qualified
 * release — not a request to rebuild them.
 */
export interface RetainedProductionManifest {
  readonly schemaVersion: 1;
  readonly kind: "retained-production";
  /** Source SHA of the production release this manifest retains. */
  readonly sourceSha: string;
  /** Public product version of that release, e.g. "0.2.15". */
  readonly productVersion: string;
  /** Reference binding this release to the qualification evidence that promoted it. */
  readonly qualificationEvidenceRef: string;
  readonly desktopApp: Slot<ArtifactLocator>;
  readonly desktopUpdater: Slot<ArtifactLocator & { readonly signature: string }>;
  /** Identity of the updater trust key (fingerprint, never the key itself). */
  readonly desktopUpdaterTrustIdentity: Slot<string>;
  readonly bundledAnyharnessVersion: Slot<string>;
  readonly bundledWorkerVersion: Slot<string>;
  readonly seedHash: Slot<string>;
  readonly catalogHash: Slot<string>;
  readonly registryHash: Slot<string>;
  readonly e2bTemplate: Slot<TemplateSlot>;
  /** Component versions/digests inside that retained template. */
  readonly templateComponents: Slot<{
    readonly anyharness: ArtifactLocator;
    readonly worker: ArtifactLocator;
    readonly supervisor: ArtifactLocator;
  }>;
  readonly installedAgentPins: Slot<Readonly<Record<string, string>>>;
}

export type AnyManifest = CandidateManifest | RetainedProductionManifest;
