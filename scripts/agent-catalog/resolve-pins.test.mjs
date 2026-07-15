import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "resolve-pins.mjs");

test("agent-process-only updates selected adapter refs without resolving native artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "catalog-resolve-pins-test-"));
  try {
    const catalogPath = join(root, "catalog.json");
    const registryPath = join(root, "registry.json");
    const native = {
      version: "rust-v0.144.1",
      source: {
        kind: "archive",
        targets: {
          linux_x64: {
            url: "https://example.test/codex.tar.gz",
            sha256: "existing-sha",
          },
        },
      },
    };
    writeFileSync(
      catalogPath,
      `${JSON.stringify(
        {
          agents: [
            {
              kind: "codex",
              harness: {
                native,
                agentProcess: {
                  version: "0.18.1-proliferate.1",
                  source: {
                    kind: "git",
                    repo: "https://github.com/proliferate-ai/codex-acp.git",
                    gitRef: "old-ref",
                    packageSubdir: "npm",
                    executableRelpath: "node_modules/.bin/codex-acp",
                  },
                },
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      registryPath,
      `${JSON.stringify(
        {
          agents: [
            {
              kind: "codex",
              native: {
                install: {
                  kind: "tarball_release",
                  versionedUrlTemplate:
                    "https://github.com/openai/codex/releases/download/{version}/codex-{target}.tar.gz",
                },
              },
              agentProcess: {
                install: {
                  kind: "managed_npm_package",
                  package:
                    "git+https://github.com/proliferate-ai/codex-acp.git#new-ref",
                  packageSubdir: "npm",
                  executableRelpath: "node_modules/.bin/codex-acp",
                },
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    execFileSync(process.execPath, [
      script,
      "--catalog",
      catalogPath,
      "--registry",
      registryPath,
      "--agent",
      "codex",
      "--agent-process-only",
    ]);

    const resolved = JSON.parse(readFileSync(catalogPath, "utf8"));
    assert.deepEqual(resolved.agents[0].harness.native, native);
    assert.equal(
      resolved.agents[0].harness.agentProcess.version,
      "0.18.1-proliferate.1",
    );
    assert.equal(resolved.agents[0].harness.agentProcess.source.gitRef, "new-ref");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
