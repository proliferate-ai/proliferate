import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parsePubkeyFingerprint,
  verifyArtifactDigest,
  buildRetainedManifest,
  retainedManifestHash,
  DigestMismatchError,
  type ProductionFeedSnapshot,
} from "./retained-manifest.js";

// The exact base64 pubkey the shipped app trusts (apps/desktop/src-tauri/tauri.conf.json).
const PROD_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDZEMkRFQkU1RDRENDI4MkUKUldRdUtOVFU1ZXN0YlFBN2ZWUjZzcXpkMWpvL1VUdWpnNmF3Q1g4U0hHYnd4MVFmUTdvaERmY04K";

function snapshot(sha256: string | null): ProductionFeedSnapshot {
  return {
    feedUrl: "https://downloads.proliferate.com/desktop/stable/latest.json",
    feed: {
      version: "0.3.26",
      pub_date: "2026-07-12T10:35:53.937Z",
      platforms: {
        "darwin-aarch64": {
          signature: "base64-sig",
          url: "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.26_aarch64.app.tar.gz",
        },
      },
    },
    immutableRecord: null,
    trustedPubkey: PROD_PUBKEY,
    artifacts: {
      "darwin-aarch64": {
        url: "https://downloads.proliferate.com/desktop/stable/Proliferate_0.3.26_aarch64.app.tar.gz",
        signature: "base64-sig",
        sizeBytes: 286706001,
        sha256,
      },
    },
    capturedAt: "2026-07-13T00:00:00Z",
  };
}

test("parsePubkeyFingerprint extracts the minisign key id, never the key material", () => {
  assert.equal(parsePubkeyFingerprint(PROD_PUBKEY), "6D2DEBE5D4D4282E");
  assert.throws(() => parsePubkeyFingerprint("bm90IGEga2V5"), /minisign key id/);
});

test("verifyArtifactDigest is exact-match only; null/absent is a hard failure", () => {
  assert.doesNotThrow(() => verifyArtifactDigest("abcDEF", "ABCdef"));
  assert.throws(() => verifyArtifactDigest("abc", "def"), DigestMismatchError);
  assert.throws(() => verifyArtifactDigest("abc", null), DigestMismatchError);
});

test("buildRetainedManifest resolves N-1 from feed version and preserves trust identity", () => {
  const m = buildRetainedManifest(snapshot("deadbeef"), { platform: "darwin-aarch64" });
  assert.equal(m.kind, "retained-production");
  assert.equal(m.productVersion, "0.3.26");
  assert.equal(m.desktopUpdaterTrustIdentity.available, true);
  if (m.desktopUpdaterTrustIdentity.available) {
    assert.equal(m.desktopUpdaterTrustIdentity.value, "6D2DEBE5D4D4282E");
  }
});

test("buildRetainedManifest fills the byte-digest slot only when hashed, else marks it unavailable", () => {
  const withHash = buildRetainedManifest(snapshot("deadbeef"), { platform: "darwin-aarch64" });
  assert.equal(withHash.desktopApp.available, true);
  if (withHash.desktopApp.available) {
    assert.equal(withHash.desktopApp.value.digest, "deadbeef");
    assert.equal(withHash.desktopApp.value.sizeBytes, 286706001);
  }
  assert.equal(withHash.desktopUpdater.available, true);

  const noHash = buildRetainedManifest(snapshot(null), { platform: "darwin-aarch64" });
  assert.equal(noHash.desktopApp.available, false);
  assert.equal(noHash.desktopUpdater.available, false);
});

test("buildRetainedManifest never fabricates undisclosed bundled/template identities", () => {
  const m = buildRetainedManifest(snapshot("deadbeef"), { platform: "darwin-aarch64" });
  assert.equal(m.bundledAnyharnessVersion.available, false);
  assert.equal(m.bundledWorkerVersion.available, false);
  assert.equal(m.catalogHash.available, false);
  assert.equal(m.registryHash.available, false);
  assert.equal(m.installedAgentPins.available, false);
  assert.equal(m.e2bTemplate.available, false);
});

test("retainedManifestHash is deterministic and digest-sensitive", () => {
  const a = buildRetainedManifest(snapshot("deadbeef"), { platform: "darwin-aarch64" });
  const b = buildRetainedManifest(snapshot("deadbeef"), { platform: "darwin-aarch64" });
  const c = buildRetainedManifest(snapshot("cafef00d"), { platform: "darwin-aarch64" });
  assert.equal(retainedManifestHash(a), retainedManifestHash(b));
  assert.notEqual(retainedManifestHash(a), retainedManifestHash(c));
});
