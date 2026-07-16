import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOUD_ADDON_ENV_KEYS,
  configureAndEnableCloudAddonProfile,
  disableCloudAddonProfile,
  githubAppCallbackBaseUrl,
  renderCloudAddonEnvLines,
  resolveCloudAddonConfig,
  stripCloudAddonKeysSedProgram,
  type CloudAddonEnvBlock,
} from "./cloud-addon.js";
import type { SshTransport } from "./world.js";

const FULL_ENV: Record<string, string> = {
  RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY: "e2b-key",
  RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME: "tmpl-1",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID: "123",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID: "Iv1.x",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET: "sec",
  RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY: "-----BEGIN-----\npem\n-----END-----",
};

function block(overrides: Partial<CloudAddonEnvBlock> = {}): CloudAddonEnvBlock {
  return {
    e2bApiKey: "e2b-key",
    e2bTemplateName: "tmpl-1",
    githubAppId: "123",
    githubAppClientId: "Iv1.x",
    githubAppClientSecret: "sec",
    githubAppPrivateKey: "-----BEGIN-----\npem\n-----END-----",
    githubAppCallbackBaseUrl: "https://box.example.com",
    ...overrides,
  };
}

// ── Pure config/env helpers ──────────────────────────────────────────────────

test("githubAppCallbackBaseUrl: returns the BARE origin (server appends the /auth/github-app route)", () => {
  assert.equal(githubAppCallbackBaseUrl("https://box.example.com"), "https://box.example.com");
  assert.equal(githubAppCallbackBaseUrl("https://box.example.com/"), "https://box.example.com");
});

test("resolveCloudAddonConfig: ok when every input is present", () => {
  const result = resolveCloudAddonConfig({ get: (name) => FULL_ENV[name] }, "https://box.example.com");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.e2bTemplateName, "tmpl-1");
    assert.equal(result.value.githubAppId, "123");
    assert.equal(result.value.block.githubAppCallbackBaseUrl, "https://box.example.com");
  }
});

test("resolveCloudAddonConfig: fails closed and names every missing input", () => {
  const result = resolveCloudAddonConfig({ get: () => undefined }, "https://box.example.com");
  assert.equal(result.ok, false);
  if (!result.ok) {
    for (const key of Object.keys(FULL_ENV)) {
      assert.match(result.reason, new RegExp(key));
    }
    assert.match(result.reason, /fails closed/);
  }
});

test("resolveCloudAddonConfig: trims whitespace and treats blank as missing", () => {
  const result = resolveCloudAddonConfig(
    { get: (name) => (name === "RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY" ? "   " : FULL_ENV[name]) },
    "https://box.example.com",
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY/);
  }
});

test("renderCloudAddonEnvLines: writes the E2B pair, App config, and single-quoted inline PEM", () => {
  const lines = renderCloudAddonEnvLines(block());
  assert.match(lines, /^E2B_API_KEY=e2b-key$/m);
  assert.match(lines, /^E2B_TEMPLATE_NAME=tmpl-1$/m);
  assert.match(lines, /^GITHUB_APP_ID=123$/m);
  assert.match(lines, /^GITHUB_APP_CALLBACK_BASE_URL=https:\/\/box\.example\.com$/m);
  // Single-line, \n-escaped, no surrounding quotes (server unescapes with replace).
  assert.match(lines, /^GITHUB_APP_PRIVATE_KEY=-----BEGIN-----\\npem\\n-----END-----$/m);
});

test("stripCloudAddonKeysSedProgram: deletes exactly the add-on keys, anchored to line start", () => {
  const program = stripCloudAddonKeysSedProgram();
  for (const key of CLOUD_ADDON_ENV_KEYS) {
    assert.ok(program.includes(`/^${key}=/d`), `should delete ${key}`);
  }
  // No stray keys beyond the declared set.
  assert.equal(program.split(";").length, CLOUD_ADDON_ENV_KEYS.length);
});

// ── SSH-touching ops (fake transport; assert the on-box motions + secret hygiene) ──

interface RecordedSsh extends SshTransport {
  scpCalls: Array<{ localPath: string; remotePath: string }>;
  runCalls: string[];
}

function fakeSsh(runImpl?: (command: string) => Promise<string> | string): RecordedSsh {
  const scpCalls: Array<{ localPath: string; remotePath: string }> = [];
  const runCalls: string[] = [];
  return {
    scpCalls,
    runCalls,
    async scp(localPath, remotePath) {
      scpCalls.push({ localPath, remotePath });
    },
    async run(command) {
      runCalls.push(command);
      return runImpl ? runImpl(command) : "";
    },
  };
}

function fakeIo(): {
  writeLocalTmp: (contents: string) => Promise<string>;
  removeLocalTmp: (path: string) => Promise<void>;
  written: string[];
  removed: string[];
} {
  const written: string[] = [];
  const removed: string[] = [];
  return {
    written,
    removed,
    async writeLocalTmp(contents) {
      written.push(contents);
      return "/tmp/cloud-addon.env";
    },
    async removeLocalTmp(path) {
      removed.push(path);
    },
  };
}

test("configureAndEnableCloudAddonProfile: scp's the 0600 block, strips-then-appends, runs bootstrap --wait, cleans up", async () => {
  const ssh = fakeSsh();
  const io = fakeIo();
  await configureAndEnableCloudAddonProfile(ssh, block(), io);
  // The secret block is written to a local tmp file and scp'd (never argv).
  assert.equal(io.written.length, 1);
  assert.match(io.written[0] ?? "", /E2B_API_KEY=e2b-key/);
  assert.equal(ssh.scpCalls.length, 1);
  // Strip-then-append precedes bootstrap; no secret value appears in any argv command.
  const sedCmd = ssh.runCalls.find((c) => c.includes("sed -i"));
  assert.ok(sedCmd, "expected a sed strip command");
  assert.ok(sedCmd?.includes("/^E2B_API_KEY=/d"), "sed should strip the add-on keys");
  assert.ok(ssh.runCalls.some((c) => c.includes("bootstrap.sh")), "expected bootstrap.sh to run");
  for (const command of ssh.runCalls) {
    assert.ok(!command.includes("e2b-key"), `secret leaked into argv: ${command}`);
    assert.ok(!command.includes("-----BEGIN-----"), `PEM leaked into argv: ${command}`);
  }
  // The local tmp file is removed in the finally.
  assert.deepEqual(io.removed, ["/tmp/cloud-addon.env"]);
});

test("configureAndEnableCloudAddonProfile: a bootstrap failure surfaces a bounded, secret-free diagnostic", async () => {
  const ssh = fakeSsh((command) => {
    if (command.includes("bootstrap.sh")) {
      throw new Error("compose up --wait timed out");
    }
    if (command.includes("ps --format")) {
      return "redis:running:starting api:running:healthy";
    }
    return "";
  });
  const io = fakeIo();
  await assert.rejects(
    () => configureAndEnableCloudAddonProfile(ssh, block(), io),
    (error: Error) => {
      assert.match(error.message, /failed to bring up the cloud-workspaces profile/);
      assert.match(error.message, /compose states/);
      assert.ok(!error.message.includes("e2b-key"), "diagnostic must not leak the E2B key");
      return true;
    },
  );
  // Even on failure the local tmp file is cleaned up.
  assert.deepEqual(io.removed, ["/tmp/cloud-addon.env"]);
});

test("disableCloudAddonProfile: strips the add-on keys and reconverges via bootstrap", async () => {
  const ssh = fakeSsh();
  const io = fakeIo();
  await disableCloudAddonProfile(ssh, io);
  const sedCmd = ssh.runCalls.find((c) => c.includes("sed -i"));
  assert.ok(sedCmd?.includes("/^E2B_API_KEY=/d"), "disable should strip the add-on keys");
  assert.ok(ssh.runCalls.some((c) => c.includes("bootstrap.sh")), "disable should reconverge via bootstrap");
});

test("disableCloudAddonProfile: a bootstrap failure diagnostic is bounded and secret-free (E2B key redacted)", async () => {
  const ssh = fakeSsh((command) => {
    if (command.includes("bootstrap.sh")) {
      throw new Error("reconverge failed");
    }
    if (command.includes("ps --format")) {
      return "redis:exited:unhealthy";
    }
    // Simulate a bootstrap log tail that echoed the raw E2B key on an error line.
    if (command.includes("cloud-addon-disable.log") || command.includes("cloud-addon-bootstrap.log")) {
      return "error: bad key e2b_deadbeefdeadbeefdeadbeef|preflight failed";
    }
    return "";
  });
  const io = fakeIo();
  await assert.rejects(
    () => disableCloudAddonProfile(ssh, io),
    (error: Error) => {
      assert.match(error.message, /failed to re-converge/);
      assert.ok(!error.message.includes("e2b_deadbeefdeadbeefdeadbeef"), "E2B key must be redacted from the diagnostic");
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    },
  );
});
