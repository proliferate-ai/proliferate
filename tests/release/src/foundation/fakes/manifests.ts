/**
 * Fixture builders for candidate and retained-production manifests.
 *
 * These produce fully-available, immutable, valid manifests by default. Tests
 * override individual slots (e.g. make one unavailable, or inject a rolling
 * locator) to exercise validation and completeness.
 */

import type {
  ArtifactLocator,
  CandidateManifest,
  RetainedProductionManifest,
  Slot,
  TemplateSlot,
} from "../contracts/artifacts.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

export function locator(overrides: Partial<ArtifactLocator> = {}): ArtifactLocator {
  return {
    locator: "s3://artifacts/candidate/abc123/artifact.bin",
    digest: DIGEST_A,
    algorithm: "sha256",
    sizeBytes: 1024,
    ...overrides,
  };
}

export function available<T>(value: T): Slot<T> {
  return { available: true, value };
}

export function unavailable<T>(reason = "not built during foundation construction"): Slot<T> {
  return { available: false, reason };
}

export function templateSlot(overrides: Partial<TemplateSlot> = {}): TemplateSlot {
  return { templateId: "tmpl_candidate_abc123", inputHash: DIGEST_B, ...overrides };
}

export function candidateManifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha: "0123456789abcdef0123456789abcdef01234567",
    sourceContentHash: DIGEST_B,
    serverImage: available(locator({ locator: "ghcr.io/proliferate/server@sha256:" + DIGEST_A })),
    webBuild: available(locator({ locator: "s3://web/abc123/build.tar.gz" })),
    desktopApp: available(locator({ locator: "s3://desktop/abc123/Proliferate.dmg" })),
    desktopUpdater: available({
      ...locator({ locator: "s3://desktop/abc123/updater.tar.gz" }),
      signature: "minisign:RWTsignaturebytes",
    }),
    anyharness: {
      "darwin-aarch64": available(locator({ locator: "s3://anyharness/abc123/darwin-aarch64" })),
      "linux-x86_64": available(locator({ locator: "s3://anyharness/abc123/linux-x86_64" })),
    },
    worker: {
      "linux-x86_64": available(locator({ locator: "s3://worker/abc123/linux-x86_64" })),
    },
    supervisor: {
      "linux-x86_64": available(locator({ locator: "s3://supervisor/abc123/linux-x86_64" })),
    },
    catalogHash: available(DIGEST_A),
    registryHash: available(DIGEST_B),
    e2bTemplate: available(templateSlot()),
    selfHostBundle: available(locator({ locator: "s3://selfhost/abc123/bundle.tar.gz" })),
    litellm: available({
      image: locator({ locator: "ghcr.io/proliferate/litellm@sha256:" + DIGEST_B }),
      configHash: DIGEST_A,
    }),
    ...overrides,
  };
}

export function retainedManifest(overrides: Partial<RetainedProductionManifest> = {}): RetainedProductionManifest {
  return {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: "fedcba9876543210fedcba9876543210fedcba98",
    productVersion: "0.2.15",
    qualificationEvidenceRef: "s3://evidence/0.2.15/qualification.json",
    desktopApp: available(locator({ locator: "s3://desktop/0.2.15/Proliferate.dmg" })),
    desktopUpdater: available({
      ...locator({ locator: "s3://desktop/0.2.15/updater.tar.gz" }),
      signature: "minisign:RWTretainedsig",
    }),
    desktopUpdaterTrustIdentity: available("minisign-key:RWTfingerprint"),
    bundledAnyharnessVersion: available("1.4.2"),
    bundledWorkerVersion: available("1.4.2"),
    seedHash: available(DIGEST_A),
    catalogHash: available(DIGEST_B),
    registryHash: available(DIGEST_A),
    e2bTemplate: available(templateSlot({ templateId: "tmpl_retained_0215" })),
    templateComponents: available({
      anyharness: locator({ locator: "s3://retained/0.2.15/anyharness" }),
      worker: locator({ locator: "s3://retained/0.2.15/worker" }),
      supervisor: locator({ locator: "s3://retained/0.2.15/supervisor" }),
    }),
    installedAgentPins: available({ claude: "1.0.0", codex: "2.0.0" }),
    ...overrides,
  };
}
