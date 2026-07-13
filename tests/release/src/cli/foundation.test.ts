import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseFoundationArgs } from "./foundation-args.js";
import { runFoundationCli, detectHostPlatform, type FoundationCliDeps } from "./foundation.js";
import { candidateManifest } from "../foundation/fakes/manifests.js";
import { FakeTier2Provisioner } from "../foundation/fakes/provisioners.js";
import { greenRunner } from "../foundation/fakes/cells.js";
import { cellKey, type CellIdentity, type WorldId } from "../foundation/contracts/identity.js";
import type { WorldProvisioner } from "../foundation/contracts/world.js";
import type { CellRunner } from "../foundation/runner/cell.js";

// --- Argument parsing -------------------------------------------------------

test("parseFoundationArgs reads every explicit axis with sane defaults", () => {
  const args = parseFoundationArgs([
    "--world", "managed-cloud",
    "--product-host", "hosted-web",
    "--selector", "release",
    "--cells", "T3-CHAT-1, T3-AUTHROUTE-1",
    "--behavior", "strict",
    "--shard", "2/4",
    "--candidate-manifest", "/tmp/c.json",
    "--retained-manifest", "/tmp/r.json",
    "--dry-run",
    "--output-dir", "/tmp/out",
  ]);
  assert.equal(args.world, "managed-cloud");
  assert.equal(args.productHost, "hosted-web");
  assert.equal(args.selector, "release");
  assert.deepEqual(args.cells, ["T3-CHAT-1", "T3-AUTHROUTE-1"]);
  assert.equal(args.behavior, "strict");
  assert.equal(args.shardIndex, 2);
  assert.equal(args.shardCount, 4);
  assert.equal(args.candidateManifestPath, "/tmp/c.json");
  assert.equal(args.retainedManifestPath, "/tmp/r.json");
  assert.equal(args.dryRun, true);
  assert.equal(args.outputDir, "/tmp/out");
});

test("parseFoundationArgs defaults to a diagnostic tier-2 one-shard plan", () => {
  const args = parseFoundationArgs([]);
  assert.equal(args.world, "tier-2");
  assert.equal(args.behavior, "diagnostic");
  assert.equal(args.shardIndex, 1);
  assert.equal(args.shardCount, 1);
  assert.equal(args.dryRun, false);
});

test("parseFoundationArgs rejects unknown flags, missing values, and invalid enums", () => {
  assert.throws(() => parseFoundationArgs(["--nope"]), /Unknown flag/);
  assert.throws(() => parseFoundationArgs(["--world"]), /requires a value/);
  assert.throws(() => parseFoundationArgs(["--world", "mars"]), /--world must be one of/);
  assert.throws(() => parseFoundationArgs(["--behavior", "green"]), /--behavior must be/);
  assert.throws(() => parseFoundationArgs(["--product-host", "smoke-signal"]), /--product-host must be/);
  assert.throws(() => parseFoundationArgs(["--shard", "5/4"]), /1 <= i <= n/);
});

test("detectHostPlatform normalizes node platform/arch pairs", () => {
  assert.equal(detectHostPlatform("darwin", "arm64"), "darwin-aarch64");
  assert.equal(detectHostPlatform("linux", "x64"), "linux-x86_64");
  assert.equal(detectHostPlatform("win32", "x64"), "win32-x64");
});

// --- End-to-end CLI ---------------------------------------------------------

function fixtureEnvFile(dir: string): string {
  // A hermetic, owner-only local secret file so the CLI never reads the
  // developer's real ~/.proliferate-local file during the test.
  const file = path.join(dir, "release-e2e.env");
  writeFileSync(file, "RELEASE_E2E_GATEWAY_TEST_KEY=dummy-value-1234\n", { mode: 0o600 });
  return file;
}

function baseDeps(dir: string, extra: Partial<FoundationCliDeps> = {}): FoundationCliDeps {
  return {
    env: { RELEASE_E2E_ENV_FILE: fixtureEnvFile(dir) },
    hostPlatform: "linux-x86_64",
    now: () => new Date("2026-07-13T00:00:00.000Z"),
    localNonce: "nonce",
    ...extra,
  };
}

function setup(): { dir: string; manifestPath: string; outputDir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "fnd-cli-"));
  const manifestPath = path.join(dir, "candidate.json");
  writeFileSync(manifestPath, JSON.stringify(candidateManifest(), null, 2));
  return { dir, manifestPath, outputDir: path.join(dir, "out") };
}

test("dry-run exits 0, is non-qualifying, and emits no green product evidence", async () => {
  const { dir, manifestPath, outputDir } = setup();
  const result = await runFoundationCli(
    ["--world", "tier-2", "--cells", "T2-AUTH-1", "--candidate-manifest", manifestPath, "--dry-run", "--output-dir", outputDir],
    baseDeps(dir),
  );
  assert.equal(result.exitCode, 0, "a diagnostic dry-run is informational");
  assert.match(result.message, /NON-QUALIFYING/);
  assert.match(result.message, /dry-run\/planning cannot emit green/);
  const evidencePath = path.join(outputDir, "local-0123456789ab-nonce", "shard-1-of-1", "evidence.json");
  const doc = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(doc.qualifying, false);
  assert.equal(doc.finals.length, 0, "no finals => no green product evidence in a dry-run");
  rmSync(dir, { recursive: true, force: true });
});

test("strict with no registered provisioner fails closed with exit code 1", async () => {
  const { dir, manifestPath, outputDir } = setup();
  const result = await runFoundationCli(
    ["--world", "tier-2", "--cells", "T2-AUTH-1", "--behavior", "strict", "--candidate-manifest", manifestPath, "--output-dir", outputDir],
    baseDeps(dir),
  );
  assert.equal(result.exitCode, 1, "a strict run that cannot reach readiness fails the process");
  assert.match(result.message, /NON-QUALIFYING/);
  rmSync(dir, { recursive: true, force: true });
});

test("strict with a ready world and one green collector qualifies and exits 0", async () => {
  const { dir, manifestPath, outputDir } = setup();
  const cell: CellIdentity = { scenarioId: "T2-AUTH-1", world: "tier-2", productHost: null, dimensions: {} };
  const provisioners = new Map<WorldId, WorldProvisioner>([["tier-2", new FakeTier2Provisioner()]]);
  const cellRunners: CellRunner[] = [greenRunner(cell)];
  const result = await runFoundationCli(
    ["--world", "tier-2", "--cells", "T2-AUTH-1", "--behavior", "strict", "--candidate-manifest", manifestPath, "--output-dir", outputDir],
    baseDeps(dir, { provisioners, cellRunners }),
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /QUALIFYING \(full\)/);
  const evidencePath = path.join(outputDir, "local-0123456789ab-nonce", "shard-1-of-1", "evidence.json");
  const doc = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(doc.qualifying, true);
  assert.equal(doc.finals.length, 1);
  assert.equal(doc.finals[0].status, "green");
  assert.equal(doc.finals[0].cellKey, cellKey(cell));
  rmSync(dir, { recursive: true, force: true });
});

test("--candidate-manifest is required for a non-dry-run", async () => {
  const { dir, outputDir } = setup();
  await assert.rejects(
    () => runFoundationCli(["--world", "tier-2", "--cells", "T2-AUTH-1", "--output-dir", outputDir], baseDeps(dir)),
    /--candidate-manifest is required/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("GitHub Actions env yields a deterministic gh run id and detected origin", async () => {
  const { dir, manifestPath, outputDir } = setup();
  const result = await runFoundationCli(
    ["--world", "tier-2", "--cells", "T2-AUTH-1", "--candidate-manifest", manifestPath, "--dry-run", "--output-dir", outputDir],
    {
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_RUN_ID: "999",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_REPOSITORY: "proliferate/proliferate",
      },
      hostPlatform: "linux-x86_64",
      now: () => new Date("2026-07-13T00:00:00.000Z"),
    },
  );
  assert.match(result.message, /run=gh-999-1/);
  assert.match(result.message, /host=github-actions/);
  assert.ok(existsSync(path.join(outputDir, "gh-999-1", "shard-1-of-1", "evidence.json")));
  rmSync(dir, { recursive: true, force: true });
});

test("--help prints usage and exits 0", async () => {
  const result = await runFoundationCli(["--help"], {});
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /Foundation runner/);
});
