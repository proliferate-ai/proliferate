import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolutionOutputs } from "./resolve-deploy-base.mjs";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "resolve-deploy-base.mjs",
);

// The output contract deploy-staging.yml's plan job builds on: `base_mode` is
// `resolved` only when a real prior deploy's head SHA was recovered; every
// other path is `fallback`, and the workflow then forces the full surface set
// so a long-idle environment cannot head^-diff its deploy down to a no-op.

test("a recovered prior deploy resolves", () => {
  const { baseSha, baseMode } = resolutionOutputs("abc123", {
    fallback: "fff000",
    head: "head99",
  });
  assert.equal(baseSha, "abc123");
  assert.equal(baseMode, "resolved");
});

test("no recovered deploy falls back to --fallback, then --head", () => {
  assert.deepEqual(resolutionOutputs("", { fallback: "fff000", head: "head99" }), {
    baseSha: "fff000",
    baseMode: "fallback",
  });
  assert.deepEqual(resolutionOutputs("", { fallback: "", head: "head99" }), {
    baseSha: "head99",
    baseMode: "fallback",
  });
});

test("the CLI writes base_sha and base_mode to GITHUB_OUTPUT on the token-less path", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "resolve-deploy-base-"));
  const outputPath = path.join(dir, "output");
  try {
    const env = { ...process.env, GITHUB_OUTPUT: outputPath };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    execFileSync(
      process.execPath,
      [scriptPath, "--workflow", "deploy-staging.yml", "--head", "head99", "--fallback", "fff000"],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    assert.equal(readFileSync(outputPath, "utf8"), "base_sha=fff000\nbase_mode=fallback\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
