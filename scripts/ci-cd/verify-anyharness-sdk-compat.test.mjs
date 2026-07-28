import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { installDevRuntimePrebuilt } from "../dev-runtime-prebuilt.mjs";
import {
  assertCompatibleOpenApi,
  verifyAnyharnessSdkCompatibility,
} from "./verify-anyharness-sdk-compat.mjs";

const SOURCE_SHA = "a".repeat(40);
const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "AnyHarness API", version: "1" },
  paths: {
    "/health": { get: { operationId: "health" } },
    "/v1/agents/{kind}/model-snapshot": {
      get: { operationId: "get_model_snapshot_status" },
    },
    "/v1/agents/{kind}/model-snapshot/refresh": {
      post: { operationId: "refresh_model_snapshot" },
    },
  },
  components: { schemas: {} },
};

async function fakeAnyharness(dir, document = OPENAPI, version = "9.9.9") {
  const binaryPath = path.join(dir, "anyharness");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
const command = process.argv[2];
if (command === "print-openapi") {
  process.stdout.write(${JSON.stringify(JSON.stringify(document))});
} else if (command === "--version") {
  process.stdout.write(${JSON.stringify(`anyharness ${version}\n`)});
} else {
  process.exit(64);
}
`,
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

test("reports SDK routes that are absent from the exact runtime binary", () => {
  const runtime = structuredClone(OPENAPI);
  delete runtime.paths["/v1/agents/{kind}/model-snapshot"];
  delete runtime.paths["/v1/agents/{kind}/model-snapshot/refresh"];

  assert.throws(
    () => assertCompatibleOpenApi(runtime, OPENAPI),
    (error) => {
      assert.ok(error.message.includes("GET /v1/agents/{kind}/model-snapshot"));
      assert.ok(error.message.includes("POST /v1/agents/{kind}/model-snapshot/refresh"));
      return true;
    },
  );
});

test("verifies OpenAPI and stamped version from one exact executable", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anyharness-sdk-compat-"));
  try {
    const binaryPath = await fakeAnyharness(dir);
    const sdkOpenApiPath = path.join(dir, "openapi.json");
    await writeFile(sdkOpenApiPath, JSON.stringify(OPENAPI));

    const proof = await verifyAnyharnessSdkCompatibility({
      binaryPath,
      sdkOpenApiPath,
      expectedVersion: "9.9.9",
    });

    assert.equal(proof.version, "9.9.9");
    assert.equal(proof.operationCount, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shared dev runtime installation is verified, atomic, and receipted", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anyharness-prebuilt-"));
  try {
    const binaryPath = await fakeAnyharness(dir);
    const sdkOpenApiPath = path.join(dir, "openapi.json");
    const destinationPath = path.join(dir, "shared", "anyharness");
    await writeFile(sdkOpenApiPath, JSON.stringify(OPENAPI));

    const installed = await installDevRuntimePrebuilt({
      binaryPath,
      destinationPath,
      sourceSha: SOURCE_SHA,
      version: "9.9.9",
      sdkOpenApiPath,
    });

    const metadata = JSON.parse(await readFile(installed.metadataPath, "utf8"));
    assert.equal(metadata.sourceSha, SOURCE_SHA);
    assert.equal(metadata.version, "9.9.9");
    assert.equal(metadata.sha256, installed.sha256);
    assert.equal(metadata.sdkOperationCount, 3);
    assert.equal(await readFile(destinationPath, "utf8"), await readFile(binaryPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Desktop release and shared-dev entrypoints fail closed on incompatible artifacts", async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const workflow = await readFile(
    path.join(repoRoot, ".github", "workflows", "release-desktop.yml"),
    "utf8",
  );
  const makefile = await readFile(path.join(repoRoot, "Makefile"), "utf8");

  assert.match(
    workflow,
    /PROLIFERATE_BUILD_VERSION="\$PROLIFERATE_RELEASE_VERSION"[\s\S]*PROLIFERATE_BUILD_SHA="\$\(git rev-parse HEAD\)"[\s\S]*cargo build --release -p anyharness/,
  );
  assert.match(
    workflow,
    /Verify embedded AnyHarness identity and SDK compatibility[\s\S]*verify-anyharness-sdk-compat\.mjs[\s\S]*--expected-version "\$PROLIFERATE_RELEASE_VERSION"/,
  );
  assert.ok(
    workflow.indexOf("- name: Verify embedded AnyHarness identity and SDK compatibility")
      < workflow.indexOf("- name: Build Tauri app"),
    "embedded runtime compatibility must be verified before Tauri packaging",
  );
  assert.match(
    makefile,
    /dev-artifacts-ready:[\s\S]*verify-anyharness-sdk-compat\.mjs --binary "\$\$runtime_bin" --quiet/,
  );
  assert.match(
    makefile,
    /refresh-dev-runtime-prebuilt:[\s\S]*pgrep -x cargo[\s\S]*pgrep -x rustc[\s\S]*dev-runtime-prebuilt\.mjs/,
  );
});
