import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { CandidateBuildMapV1 } from "./build-map.js";
import { runAnyharnessHandoffSmoke } from "./anyharness-smoke.js";

const SHA = "a".repeat(40);

/**
 * A stand-in "binary" honoring the real launch contract
 * (`serve --host H --port P --runtime-home HOME`, JSON `/health`), so the
 * smoke's materialize/launch/poll/assert/terminate mechanics are provable
 * without a cargo build. The real release binary is exercised by
 * `make qualification-candidate-handoff-smoke`.
 */
async function fakeServeBinary(dir: string, options: { version: string; status?: string }): Promise<{
  binaryPath: string;
  sha256: string;
}> {
  const script = `#!/usr/bin/env node
const http = require("http");
const args = process.argv.slice(2);
function val(flag) { const i = args.indexOf(flag); return args[i + 1]; }
if (args[0] !== "serve") { process.exit(64); }
const home = val("--runtime-home");
http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: ${JSON.stringify(options.status ?? "ok")}, version: ${JSON.stringify(
    options.version,
  )}, runtimeHome: home }));
}).listen(Number(val("--port")), val("--host"));
`;
  const binaryPath = path.join(dir, `fake-anyharness-${options.version}-${options.status ?? "ok"}`);
  await writeFile(binaryPath, script);
  await chmod(binaryPath, 0o755);
  return { binaryPath, sha256: createHash("sha256").update(script).digest("hex") };
}

function mapFor(binaryPath: string, sha256: string, version: string): CandidateBuildMapV1 {
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: SHA,
    artifacts: [
      {
        artifact_id: "anyharness/test-host",
        version,
        sha256,
        locator: { kind: "local_file", path: binaryPath },
      },
    ],
  };
}

test("launches the mapped bytes, verifies health identity, and terminates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smoke-test-"));
  try {
    const { binaryPath, sha256 } = await fakeServeBinary(dir, { version: "9.9.9" });
    const proof = await runAnyharnessHandoffSmoke({
      map: mapFor(binaryPath, sha256, "9.9.9"),
      timeoutMs: 15_000,
    });
    assert.equal(proof.health.status, "ok");
    assert.equal(proof.health.version, "9.9.9");
    assert.deepEqual(proof.artifact, {
      artifact_id: "anyharness/test-host",
      version: "9.9.9",
      sha256,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a version mismatch fails and still terminates the child", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smoke-test-"));
  try {
    const { binaryPath, sha256 } = await fakeServeBinary(dir, { version: "9.9.9" });
    await assert.rejects(
      runAnyharnessHandoffSmoke({ map: mapFor(binaryPath, sha256, "1.0.0"), timeoutMs: 15_000 }),
      /does not match the build map version/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a non-ok health status fails", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smoke-test-"));
  try {
    const { binaryPath, sha256 } = await fakeServeBinary(dir, { version: "9.9.9", status: "degraded" });
    await assert.rejects(
      runAnyharnessHandoffSmoke({ map: mapFor(binaryPath, sha256, "9.9.9"), timeoutMs: 15_000 }),
      /status is "degraded"/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a binary that exits immediately fails with a bounded launch error", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smoke-test-"));
  try {
    const script = "#!/usr/bin/env node\nprocess.exit(3);\n";
    const binaryPath = path.join(dir, "fake-anyharness-dies");
    await writeFile(binaryPath, script);
    await chmod(binaryPath, 0o755);
    const sha256 = createHash("sha256").update(script).digest("hex");
    await assert.rejects(
      runAnyharnessHandoffSmoke({ map: mapFor(binaryPath, sha256, "9.9.9"), timeoutMs: 15_000 }),
      /exited before becoming healthy/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a map without exactly one anyharness artifact is rejected", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smoke-test-"));
  try {
    const { binaryPath, sha256 } = await fakeServeBinary(dir, { version: "9.9.9" });
    const map = mapFor(binaryPath, sha256, "9.9.9");
    map.artifacts[0].artifact_id = "server/test-host";
    await assert.rejects(runAnyharnessHandoffSmoke({ map }), /exactly one anyharness/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
