import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validatorPath = fileURLToPath(new URL("./validate-agent-catalog.mjs", import.meta.url));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "agent-catalog-validator-"));
  mkdirSync(path.join(root, "catalogs/agents"), { recursive: true });
  mkdirSync(path.join(root, "scripts/agent-catalog/generated"), { recursive: true });
  const catalog = {
    schemaVersion: 2,
    catalogVersion: "test.1",
    probedAgainst: { registryVersion: "registry.1" },
    generatedAt: "2026-08-19T00:00:00Z",
    agents: [{
      kind: "claude",
      displayName: "Claude",
      harness: {
        agentProcess: { version: "0.59.0-proliferate.1", source: { kind: "git" } },
        native: { version: "2.1.212" },
      },
      authContexts: [{ id: "anthropic-api", authSlotId: "anthropic" }],
      session: {
        supportsGoals: true,
        presentationModels: [{ id: "default", displayName: "Default" }],
      },
      provenance: {
        runs: [{
          id: "claude.anthropic-api",
          snapshotPath: "generated/claude.anthropic-api.probe.json",
        }],
      },
    }],
  };
  const registry = {
    registryVersion: "registry.1",
    agents: [{ kind: "claude", authCardinality: "single" }],
  };
  const snapshot = {
    agentKind: "claude",
    authContext: "anthropic-api",
    nativeCli: { version: "2.1.212 (Claude Code)" },
    attestation: { version: "0.59.0-proliferate.1" },
  };
  writeCatalogLockfile(root, catalog);
  writeFileSync(path.join(root, "catalogs/agents/registry.json"), JSON.stringify(registry));
  const snapshotPath = path.join(root, "scripts/agent-catalog/generated/claude.anthropic-api.probe.json");
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  return { root, catalog, snapshot, snapshotPath };
}

function writeCatalogLockfile(root, catalog) {
  const raw = JSON.stringify(catalog);
  writeFileSync(path.join(root, "catalogs/agents/catalog.json"), raw);
  writeFileSync(path.join(root, "scripts/agent-catalog/catalog.draft.json"), raw);
}

test("accepts a matching distribution and presentation catalog", () => {
  const { root } = fixture();
  try {
    const output = execFileSync(process.execPath, [validatorPath], { cwd: root, encoding: "utf8" });
    assert.match(output, /agent catalog OK: test\.1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects stale adapter attestation in committed probe evidence", () => {
  const { root, snapshot, snapshotPath } = fixture();
  try {
    snapshot.attestation.version = "0.44.0";
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
    assert.throws(
      () => execFileSync(process.execPath, [validatorPath], { cwd: root, encoding: "utf8" }),
      /attests '0\.44\.0', expected '0\.59\.0-proliferate\.1'/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects executable catalog fields", () => {
  const { root, catalog } = fixture();
  try {
    catalog.agents[0].session.controls = [{ id: "mode", values: ["unsafe"] }];
    writeCatalogLockfile(root, catalog);
    assert.throws(
      () => execFileSync(process.execPath, [validatorPath], { cwd: root, encoding: "utf8" }),
      /forbidden executable session field 'controls'/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects executable metadata on presentation models", () => {
  const { root, catalog } = fixture();
  try {
    catalog.agents[0].session.presentationModels[0].defaultVisible = true;
    writeCatalogLockfile(root, catalog);
    assert.throws(
      () => execFileSync(process.execPath, [validatorPath], { cwd: root, encoding: "utf8" }),
      /presentation model contains executable metadata/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
