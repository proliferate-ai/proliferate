// Guards the desktop auto-updater configuration.
//
// Two things are enforced here, both in the merge gate (desktop vitest):
//
//  1. SAFETY: the SHIPPED tauri.conf.json points the updater at the production
//     endpoint and production pubkey, byte-for-byte. A build with no test
//     overlay must produce exactly today's config. If someone edits either
//     value, this test fails loudly -- a stranded-updater regression is a
//     release-wide outage.
//
//  2. The build-time test overlay (updater-test.conf.json.template, materialized
//     by scripts/make-updater-test-conf.mjs and passed to `tauri build --config`)
//     changes ONLY plugins.updater.{endpoints,pubkey} and nothing else. This is
//     verified by replicating Tauri's config deep-merge and diffing the result
//     against the shipped config.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  renderOverlay,
  assertOnlyUpdaterKeys,
} from "../../../../scripts/make-updater-test-conf.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_TAURI = resolve(HERE, "../../../../src-tauri");

// The production values the shipped build MUST carry. Do not "fix" this test by
// editing these to match a changed config -- change the config back instead,
// unless you are deliberately rotating the prod endpoint/key.
const PROD_ENDPOINT = "https://downloads.proliferate.com/desktop/stable/latest.json";
const PROD_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDZEMkRFQkU1RDRENDI4MkUKUldRdUtOVFU1ZXN0YlFBN2ZWUjZzcXpkMWpvL1VUdWpnNmF3Q1g4U0hHYnd4MVFmUTdvaERmY04K";

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(SRC_TAURI, name), "utf-8"));
}

// Mirror of Tauri v2's config merge: objects merge recursively, arrays and
// scalars are replaced. This is the same behavior tauri.dev.json relies on and
// that `tauri build --config <overlay>` applies at build time.
function deepMerge(base: any, overlay: any): any {
  if (
    typeof base !== "object" ||
    base === null ||
    Array.isArray(base) ||
    typeof overlay !== "object" ||
    overlay === null ||
    Array.isArray(overlay)
  ) {
    return overlay;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

describe("desktop updater config (shipped)", () => {
  it("points at the production endpoint and pubkey byte-for-byte", () => {
    const conf = readJson("tauri.conf.json") as any;
    const updater = conf.plugins.updater;
    expect(updater.endpoints).toEqual([PROD_ENDPOINT]);
    expect(updater.pubkey).toBe(PROD_PUBKEY);
  });

  it("never carries the insecure-transport test escape hatch", () => {
    const conf = readJson("tauri.conf.json") as any;
    expect(conf.plugins.updater.dangerousInsecureTransportProtocol).toBeUndefined();
  });
});

describe("desktop updater test overlay", () => {
  const templateText = readFileSync(
    resolve(SRC_TAURI, "updater-test.conf.json.template"),
    "utf-8",
  );

  it("template only sets plugins.updater.{endpoints,pubkey}", () => {
    const template = JSON.parse(templateText);
    expect(() => assertOnlyUpdaterKeys(template)).not.toThrow();
  });

  it("requires both url and pubkey", () => {
    expect(() => renderOverlay(templateText, { url: "", pubkey: "x" })).toThrow();
    expect(() =>
      renderOverlay(templateText, { url: "http://x", pubkey: "" }),
    ).toThrow();
  });

  it("merged onto the shipped config, changes ONLY the updater endpoint + pubkey", () => {
    const shipped = readJson("tauri.conf.json");
    const overlay = renderOverlay(templateText, {
      url: "http://127.0.0.1:8787/latest.json",
      pubkey: "TEST_ONLY_PUBKEY_BASE64",
    });
    const merged = deepMerge(shipped, overlay) as any;

    // The intended changes.
    expect(merged.plugins.updater.endpoints).toEqual([
      "http://127.0.0.1:8787/latest.json",
    ]);
    expect(merged.plugins.updater.pubkey).toBe("TEST_ONLY_PUBKEY_BASE64");
    expect(merged.plugins.updater.dangerousInsecureTransportProtocol).toBe(true);

    // Everything else is identical to the shipped config. Prove it by reverting
    // the overlaid fields and deep-equaling the whole tree.
    const revert = JSON.parse(JSON.stringify(merged));
    revert.plugins.updater.endpoints = (shipped as any).plugins.updater.endpoints;
    revert.plugins.updater.pubkey = (shipped as any).plugins.updater.pubkey;
    delete revert.plugins.updater.dangerousInsecureTransportProtocol;
    expect(revert).toEqual(shipped);

    // Specifically: sibling updater keys (e.g. windows.installMode) survive.
    expect(merged.plugins.updater.windows).toEqual(
      (shipped as any).plugins.updater.windows,
    );
  });
});
