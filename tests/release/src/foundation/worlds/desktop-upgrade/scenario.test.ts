import assert from "node:assert/strict";
import { test } from "node:test";

import { runDesktopUpgradeSlice } from "./scenario.js";
import type { DesktopUpgradeControls } from "./provisioner.js";
import { IsolatedUpdaterFeed } from "./feed.js";
import type { RetainedProductionManifest } from "../../contracts/artifacts.js";

function retained(): RetainedProductionManifest {
  return {
    schemaVersion: 1,
    kind: "retained-production",
    sourceSha: "abc",
    productVersion: "0.3.26",
    qualificationEvidenceRef: "ref",
    desktopApp: { available: false, reason: "n/a" },
    desktopUpdater: { available: false, reason: "n/a" },
    desktopUpdaterTrustIdentity: { available: true, value: "6D2DEBE5D4D4282E" },
    bundledAnyharnessVersion: { available: false, reason: "n/a" },
    bundledWorkerVersion: { available: false, reason: "n/a" },
    seedHash: { available: false, reason: "n/a" },
    catalogHash: { available: false, reason: "n/a" },
    registryHash: { available: false, reason: "n/a" },
    e2bTemplate: { available: false, reason: "n/a" },
    templateComponents: { available: false, reason: "n/a" },
    installedAgentPins: { available: false, reason: "n/a" },
  };
}

function controls(feed: IsolatedUpdaterFeed): DesktopUpgradeControls {
  return {
    feed,
    isolatedHome: {
      base: "/tmp/iso",
      home: "/tmp/iso/home",
      appData: "/tmp/iso/app",
      runtimeHome: "/tmp/iso/rt",
      installDir: "/tmp/iso/Applications",
      feedDir: "/tmp/iso/feed",
    },
    installedAppPath: "/tmp/iso/Applications/Proliferate.app",
    retained: retained(),
    trustChain: "throwaway",
  };
}

test("slice reports BLOCKED (never green) when no candidate/driver is available", async () => {
  const feed = new IsolatedUpdaterFeed("0.3.26");
  try {
    await feed.start();
    const report = await runDesktopUpgradeSlice(controls(feed), {
      candidate: null,
      updaterDriverBin: null,
      readVersion: () => "0.3.26",
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.productionTrustChain, false);
    // The real product baseline is honestly blocked, not silently green.
    const baseline = report.steps.find((s) => s.step === "baseline.launch-auth-session-turn");
    assert.equal(baseline?.status, "blocked");
    // The mechanism step is blocked with the exact missing-artifact reason.
    assert.equal(report.steps.find((s) => s.step === "upgrade.mechanism")?.status, "blocked");
  } finally {
    await feed.close();
  }
});

test("slice fails (not green) when the baseline version does not match retained N-1", async () => {
  const feed = new IsolatedUpdaterFeed("0.3.26");
  try {
    await feed.start();
    const report = await runDesktopUpgradeSlice(controls(feed), {
      candidate: null,
      updaterDriverBin: null,
      readVersion: () => "9.9.9",
    });
    assert.equal(report.steps.find((s) => s.step === "baseline.version")?.status, "failed");
    assert.equal(report.status, "failed");
  } finally {
    await feed.close();
  }
});

test("slice never returns green under a throwaway trust chain, even with a candidate present", async () => {
  const feed = new IsolatedUpdaterFeed("0.3.26");
  try {
    await feed.start();
    // Candidate present but files won't exist -> blocked before any fake pass.
    const report = await runDesktopUpgradeSlice(controls(feed), {
      candidate: {
        version: "0.3.27",
        platform: "darwin-aarch64",
        tarballPath: "/tmp/does-not-exist.app.tar.gz",
        signaturePath: "/tmp/does-not-exist.app.tar.gz.sig",
        trustChain: "throwaway",
        pubkey: "throwaway-pubkey",
      },
      updaterDriverBin: "/tmp/no-driver",
      readVersion: () => "0.3.26",
    });
    assert.notEqual(report.status, "green");
    assert.equal(report.productionTrustChain, false);
  } finally {
    await feed.close();
  }
});
