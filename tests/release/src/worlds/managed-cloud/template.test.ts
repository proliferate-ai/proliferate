import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import {
  buildAgentInstallCommand,
  computeBakedInputDigests,
  computeManagedCloudTemplateHash,
  MANAGED_CLOUD_ANYHARNESS_RUNTIME_HOME,
  resolveOrBuildManagedCloudTemplate,
  type E2bBuildConfig,
  type ManagedCloudTemplateBuilder,
  type ManagedCloudTemplateInputs,
} from "./template.js";

function fakeArtifact(id: string, sha256: string, materializedPath: string): MaterializedArtifact {
  return { artifact_id: id, version: "0.3.28", sha256, path: materializedPath };
}

async function baseInputs(dir: string): Promise<ManagedCloudTemplateInputs> {
  return {
    anyharness: fakeArtifact("anyharness/x86_64-unknown-linux-musl", "a".repeat(64), path.join(dir, "anyharness")),
    worker: fakeArtifact("worker/x86_64-unknown-linux-musl", "b".repeat(64), path.join(dir, "worker")),
    supervisor: fakeArtifact("supervisor/x86_64-unknown-linux-musl", "c".repeat(64), path.join(dir, "supervisor")),
    credentialHelper: fakeArtifact(
      "credential-helper/x86_64-unknown-linux-musl",
      "d".repeat(64),
      path.join(dir, "credential-helper"),
    ),
    bootstrapInputs: [],
    agentKinds: ["claude", "codex"],
  };
}

function fakeConfig(overrides: Partial<E2bBuildConfig> = {}): E2bBuildConfig {
  return {
    teamId: "team-1",
    secretsEnvFilePath: "/dev/null",
    templateName: "proliferate-runtime-qual-run1",
    ...overrides,
  };
}

test("computeBakedInputDigests returns the four binaries in fixed bake order, reusing their materialized sha256", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  try {
    const inputs = await baseInputs(dir);
    const digests = await computeBakedInputDigests(inputs);
    assert.deepEqual(
      digests.map((digest) => digest.destination),
      [
        "/home/user/anyharness",
        "/home/user/.proliferate/bin/proliferate-worker",
        "/home/user/.proliferate/bin/proliferate-supervisor",
        "/home/user/.proliferate/bin/proliferate-git-credential-helper",
      ],
    );
    assert.deepEqual(
      digests.map((digest) => digest.sha256),
      ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeBakedInputDigests hashes bootstrap inputs and appends them after the four binaries", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  try {
    const inputs = await baseInputs(dir);
    const bootstrapPath = path.join(dir, "catalog.json");
    await writeFile(bootstrapPath, "bootstrap-bytes");
    inputs.bootstrapInputs = [{ sourcePath: bootstrapPath, destination: "/home/user/.proliferate/catalog.json" }];
    const digests = await computeBakedInputDigests(inputs);
    assert.equal(digests.length, 5);
    assert.equal(digests[4].destination, "/home/user/.proliferate/catalog.json");
    assert.equal(digests[4].sha256.length, 64);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeBakedInputDigests rejects a bootstrap destination outside /home/user/...", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  try {
    const inputs = await baseInputs(dir);
    const bootstrapPath = path.join(dir, "catalog.json");
    await writeFile(bootstrapPath, "bootstrap-bytes");
    inputs.bootstrapInputs = [{ sourcePath: bootstrapPath, destination: "/tmp/catalog.json" }];
    await assert.rejects(computeBakedInputDigests(inputs), /\/home\/user\//);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeManagedCloudTemplateHash is stable for identical inputs and changes when a binary's sha256 changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  try {
    const inputs = await baseInputs(dir);
    const hash1 = await computeManagedCloudTemplateHash(inputs);
    const hash2 = await computeManagedCloudTemplateHash(await baseInputs(dir));
    assert.equal(hash1, hash2);

    const changed = await baseInputs(dir);
    changed.anyharness = fakeArtifact(changed.anyharness.artifact_id, "e".repeat(64), changed.anyharness.path);
    const hash3 = await computeManagedCloudTemplateHash(changed);
    assert.notEqual(hash1, hash3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildAgentInstallCommand pins HOME and --runtime-home to the serving runtime's home", () => {
  const command = buildAgentInstallCommand(["claude", "codex"]);
  // The serving runtime resolves default_runtime_home() = $HOME/.proliferate/anyharness
  // with the launch script exporting HOME=/home/user; a Docker/E2B build-stage
  // `USER user` does NOT update $HOME, so the bake must pin BOTH explicitly or
  // the agents install where the runtime never looks (readiness then reports
  // InstallRequired and launch-options lists zero launchable agents).
  assert.ok(command.includes("export HOME=/home/user"), "bake must pin HOME explicitly");
  assert.ok(
    command.includes(`--runtime-home ${MANAGED_CLOUD_ANYHARNESS_RUNTIME_HOME}`),
    "bake must pin the install runtime home explicitly",
  );
  assert.equal(MANAGED_CLOUD_ANYHARNESS_RUNTIME_HOME, "/home/user/.proliferate/anyharness");
  assert.ok(command.includes("--agent 'claude'") && command.includes("--agent 'codex'"));
});

test("buildAgentInstallCommand shell-quotes agent kinds so they cannot break out of the command string", () => {
  const command = buildAgentInstallCommand(["claude' ; rm -rf / #"]);
  // The malicious kind must appear only inside a single-quoted argument, with
  // its own single quote escaped via the POSIX '\'' pattern — never as bare
  // shell syntax that could terminate the quoting and inject a command.
  assert.ok(command.includes(`--agent 'claude'\\'' ; rm -rf / #'`));
  assert.ok(!command.includes("--agent claude' ; rm -rf / #"));
});

test("computeManagedCloudTemplateHash changes when agentKinds change", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  try {
    const inputs = await baseInputs(dir);
    const hash1 = await computeManagedCloudTemplateHash(inputs);
    const changed = await baseInputs(dir);
    changed.agentKinds = ["claude"];
    const hash2 = await computeManagedCloudTemplateHash(changed);
    assert.notEqual(hash1, hash2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Records every builder call; never talks to the real E2B API. */
function fakeBuilder(): { builder: ManagedCloudTemplateBuilder; deleteCalls: string[] } {
  const deleteCalls: string[] = [];
  const builder: ManagedCloudTemplateBuilder = {
    buildAndPublish: async (_inputs, config) => ({
      templateId: "tmpl-123",
      buildId: "build-456",
      templateName: config.templateName,
    }),
    deleteTemplate: async (templateId) => {
      deleteCalls.push(templateId);
    },
  };
  return { builder, deleteCalls };
}

test("resolveOrBuildManagedCloudTemplate builds on a cache miss, registers before returning, and the release deletes the template", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-cache-"));
  try {
    const inputs = await baseInputs(dir);
    const config = fakeConfig();
    const { builder, deleteCalls } = fakeBuilder();
    const registered: { providerId: string; release: () => Promise<void> }[] = [];
    const receipt = await resolveOrBuildManagedCloudTemplate({
      inputs,
      config,
      builder,
      cacheDir,
      register: async (providerId, release) => {
        registered.push({ providerId, release });
      },
    });

    assert.equal(receipt.artifact_id, "e2b-template/proliferate-runtime-qual-run1");
    assert.equal(receipt.templateId, "tmpl-123");
    assert.equal(receipt.buildId, "build-456");
    assert.equal(receipt.bakedInputs.length, 4);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].providerId, "tmpl-123");

    await registered[0].release();
    assert.deepEqual(deleteCalls, ["tmpl-123"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("resolveOrBuildManagedCloudTemplate reuses the cached receipt on a second call with unchanged inputs and does not rebuild", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-cache-"));
  try {
    const inputs = await baseInputs(dir);
    const config = fakeConfig();
    let buildCount = 0;
    const builder: ManagedCloudTemplateBuilder = {
      buildAndPublish: async (_i, cfg) => {
        buildCount += 1;
        return { templateId: "tmpl-abc", buildId: "build-def", templateName: cfg.templateName };
      },
      deleteTemplate: async () => undefined,
    };
    const register = async () => undefined;

    const first = await resolveOrBuildManagedCloudTemplate({ inputs, config, builder, cacheDir, register });
    const second = await resolveOrBuildManagedCloudTemplate({
      inputs: await baseInputs(dir),
      config,
      builder,
      cacheDir,
      register,
    });

    assert.equal(buildCount, 1);
    assert.equal(second.templateId, first.templateId);
    assert.equal(second.buildId, first.buildId);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("resolveOrBuildManagedCloudTemplate rejects an empty provider id from the builder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-cache-"));
  try {
    const inputs = await baseInputs(dir);
    const config = fakeConfig();
    const builder: ManagedCloudTemplateBuilder = {
      buildAndPublish: async () => ({ templateId: "", buildId: "build-1", templateName: config.templateName }),
      deleteTemplate: async () => undefined,
    };
    await assert.rejects(
      resolveOrBuildManagedCloudTemplate({
        inputs,
        config,
        builder,
        cacheDir,
        register: async () => undefined,
      }),
      /empty provider id/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("resolveOrBuildManagedCloudTemplate rejects a bootstrap destination outside /home/user/... before building", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-"));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "managed-cloud-template-cache-"));
  try {
    const inputs = await baseInputs(dir);
    const bootstrapPath = path.join(dir, "catalog.json");
    await writeFile(bootstrapPath, "bytes");
    inputs.bootstrapInputs = [{ sourcePath: bootstrapPath, destination: "/tmp/catalog.json" }];
    let buildAttempted = false;
    const wrappedBuilder: ManagedCloudTemplateBuilder = {
      buildAndPublish: async (_inputs, config) => {
        buildAttempted = true;
        return { templateId: "tmpl-x", buildId: "build-x", templateName: config.templateName };
      },
      deleteTemplate: async () => undefined,
    };
    await assert.rejects(
      resolveOrBuildManagedCloudTemplate({
        inputs,
        config: fakeConfig(),
        builder: wrappedBuilder,
        cacheDir,
        register: async () => undefined,
      }),
      /\/home\/user\//,
    );
    assert.equal(buildAttempted, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});
