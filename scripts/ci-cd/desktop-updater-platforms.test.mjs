import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const generator = path.join(repoRoot, "scripts", "generate-updater-manifest.mjs");
const contractPath = path.join(repoRoot, "fixtures", "contracts", "desktop-updater", "platforms.json");

function runGenerator(artifactsDir, output) {
  return spawnSync(
    process.execPath,
    [
      generator,
      "--version",
      "9.9.9",
      "--artifacts-dir",
      artifactsDir,
      "--base-url",
      "https://downloads.example.test/desktop/stable",
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
}

test("updater generator and release diagnostic share an exact shipped-platform contract", () => {
  const root = mkdtempSync(path.join(tmpdir(), "proliferate-updater-platforms-"));
  try {
    const armDir = path.join(root, "desktop-aarch64-apple-darwin");
    const x64Dir = path.join(root, "desktop-x86_64-apple-darwin");
    mkdirSync(armDir);
    mkdirSync(x64Dir);
    writeFileSync(path.join(armDir, "Proliferate_9.9.9_aarch64.app.tar.gz"), "arm artifact");
    writeFileSync(path.join(armDir, "Proliferate_9.9.9_aarch64.app.tar.gz.sig"), "arm signature");
    writeFileSync(path.join(x64Dir, "Proliferate_9.9.9_x64.app.tar.gz"), "x64 artifact");
    writeFileSync(path.join(x64Dir, "Proliferate_9.9.9_x64.app.tar.gz.sig"), "x64 signature");

    const output = path.join(root, "latest.json");
    const generated = runGenerator(root, output);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    const manifest = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(contract.schemaVersion, 1);
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [...contract.platforms].sort());

    rmSync(path.join(x64Dir, "Proliferate_9.9.9_x64.app.tar.gz"));
    const incomplete = runGenerator(root, output);
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stderr, /Missing artifact file for darwin-x86_64/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
