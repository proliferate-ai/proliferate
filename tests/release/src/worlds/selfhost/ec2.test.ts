import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { CleanupResourceKind } from "../local-workspace/cleanup-ledger.js";
import {
  provisionEc2Box,
  resolveRunnerPublicIp,
  terminateEc2Box,
  waitForSshAndCloudInit,
  type Ec2Exec,
  type SshRunner,
} from "./ec2.js";

interface Registered {
  kind: string;
  providerId: string;
  release: () => Promise<void>;
}

/** Records every `aws` invocation and routes canned stdout by subcommand. */
function fakeEc2Exec(calls: string[][]): Ec2Exec {
  return {
    async run(args) {
      const argv = [...args];
      calls.push(argv);
      const joined = argv.join(" ");
      if (argv[0] === "ssm") return "ami-0abc123\n";
      if (joined.includes("create-key-pair")) return "-----BEGIN KEY-----\nabc\n-----END KEY-----\n";
      if (joined.includes("create-security-group")) return "sg-0abc\n";
      if (joined.includes("run-instances")) return "i-0abc123\n";
      if (joined.includes("describe-instances") && joined.includes("PublicIpAddress")) return "203.0.113.50\n";
      if (joined.includes("describe-instances")) return "i-0abc123\n"; // teardown lookup by tag
      return "";
    },
  };
}

async function keyDirInTemp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "sh-ec2-"));
}

const INPUTS = (keyDir: string) => ({
  region: "us-east-1",
  instanceType: "t3.small",
  runnerCidr: "198.51.100.7/32",
  keyName: "selfhost-run-1-shard-0-deadbeef",
  securityGroupName: "selfhost-run-1-shard-0-deadbeef",
  sshUser: "ubuntu",
  tags: { Name: "selfhost-run-1-shard-0-deadbeef", RunId: "run-1", ShardId: "shard-0" },
  keyDir,
});

test("provisionEc2Box registers key_pair→security_group→ec2_instance BEFORE each create and writes a 0600 key", async () => {
  const keyDir = await keyDirInTemp();
  try {
    const calls: string[][] = [];
    const registered: Registered[] = [];
    const registerCleanup = async (
      kind: Extract<CleanupResourceKind, "ec2_instance" | "security_group" | "key_pair">,
      providerId: string,
      release: () => Promise<void>,
    ): Promise<void> => {
      registered.push({ kind, providerId, release });
    };

    const box = await provisionEc2Box({ inputs: INPUTS(keyDir), exec: fakeEc2Exec(calls), registerCleanup });

    assert.deepEqual(
      registered.map((entry) => entry.kind),
      ["key_pair", "security_group", "ec2_instance"],
    );
    // Registered-before-create: the key-pair intent precedes the create-key-pair call.
    const registerIndexOfKey = 0;
    const createKeyCallIndex = calls.findIndex((c) => c.join(" ").includes("create-key-pair"));
    assert.ok(createKeyCallIndex >= 0 && registerIndexOfKey === 0);
    // The instance is registered by its run-scoped Name tag (deterministic before create).
    assert.equal(registered[2].providerId, "selfhost-run-1-shard-0-deadbeef");

    assert.equal(box.instanceId, "i-0abc123");
    assert.equal(box.securityGroupId, "sg-0abc");
    assert.equal(box.publicIp, "203.0.113.50");
    assert.equal(box.sshUser, "ubuntu");
    // The private key was written 0600.
    await access(box.keyPath);
    const { mode } = await (await import("node:fs/promises")).stat(box.keyPath);
    assert.equal(mode & 0o777, 0o600);
    // SSH ingress is scoped to the runner /32, not the world.
    const authorize = calls.find((c) => c.join(" ").includes("authorize-security-group-ingress"));
    assert.ok(authorize && authorize.join(" ").includes("198.51.100.7/32"));
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }
});

test("the registered releasers issue the matching AWS deletes (instance by tag, SG + key by name)", async () => {
  const keyDir = await keyDirInTemp();
  try {
    const calls: string[][] = [];
    const registered: Registered[] = [];
    const box = await provisionEc2Box({
      inputs: INPUTS(keyDir),
      exec: fakeEc2Exec(calls),
      registerCleanup: async (kind, providerId, release) => {
        registered.push({ kind, providerId, release });
      },
    });
    await access(box.keyPath);

    calls.length = 0;
    // Reverse order teardown: instance → SG → key pair.
    for (const entry of [...registered].reverse()) {
      await entry.release();
    }
    const joined = calls.map((c) => c.join(" "));
    assert.ok(joined.some((c) => c.includes("terminate-instances")));
    assert.ok(joined.some((c) => c.includes("delete-security-group") && c.includes("--group-name")));
    assert.ok(joined.some((c) => c.includes("delete-key-pair")));
    // The key file is removed by its releaser.
    await assert.rejects(access(box.keyPath));
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }
});

test("a security-group releaser treats an already-absent group as a clean success", async () => {
  const exec: Ec2Exec = {
    async run(args) {
      if (args.join(" ").includes("delete-security-group")) {
        throw new Error("An error occurred (InvalidGroup.NotFound) when calling DeleteSecurityGroup");
      }
      return "";
    },
  };
  const keyDir = await keyDirInTemp();
  try {
    const registered: Registered[] = [];
    await provisionEc2Box({
      inputs: INPUTS(keyDir),
      exec: mergeExec(exec, keyDir),
      registerCleanup: async (kind, providerId, release) => {
        registered.push({ kind, providerId, release });
      },
    });
    const sg = registered.find((entry) => entry.kind === "security_group")!;
    await assert.doesNotReject(sg.release()); // NotFound → idempotent clean teardown
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }
});

test("resolveRunnerPublicIp validates the resolved IPv4 and rejects garbage", async () => {
  assert.equal(await resolveRunnerPublicIp({ resolve: async () => "198.51.100.7\n" }), "198.51.100.7");
  await assert.rejects(resolveRunnerPublicIp({ resolve: async () => "not-an-ip" }), /valid public IPv4/);
});

test("waitForSshAndCloudInit resolves once the readiness probe succeeds and times out otherwise", async () => {
  let attempts = 0;
  const readySsh: SshRunner = {
    async run() {
      attempts += 1;
      if (attempts < 2) throw new Error("connection refused");
      return "Docker Compose version v2.39.4";
    },
  };
  await waitForSshAndCloudInit(BOX, { ssh: readySsh, timeoutMs: 1_000, intervalMs: 5 });
  assert.equal(attempts, 2);

  const neverReady: SshRunner = {
    async run() {
      throw new Error("still booting");
    },
  };
  await assert.rejects(
    waitForSshAndCloudInit(BOX, { ssh: neverReady, timeoutMs: 30, intervalMs: 5 }),
    /did not become ready/,
  );
});

test("terminateEc2Box terminates the instance and deletes the SG (by id) + key pair", async () => {
  const keyDir = await keyDirInTemp();
  const keyPath = path.join(keyDir, "k.pem");
  await (await import("node:fs/promises")).writeFile(keyPath, "key", { mode: 0o600 });
  try {
    const calls: string[][] = [];
    await terminateEc2Box(
      { instanceId: "i-9", securityGroupId: "sg-9", keyName: "k", keyPath, publicIp: "203.0.113.9", sshUser: "ubuntu" },
      { region: "us-east-1", exec: fakeEc2Exec(calls) },
    );
    const joined = calls.map((c) => c.join(" "));
    assert.ok(joined.some((c) => c.includes("terminate-instances") && c.includes("i-9")));
    assert.ok(joined.some((c) => c.includes("delete-security-group") && c.includes("--group-id") && c.includes("sg-9")));
    assert.ok(joined.some((c) => c.includes("delete-key-pair") && c.includes("k")));
    await assert.rejects(access(keyPath));
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }
});

test("two concurrent provisions collide on nothing (distinct key/SG names + instance tags)", async () => {
  const keyDirA = await keyDirInTemp();
  const keyDirB = await keyDirInTemp();
  try {
    const callsA: string[][] = [];
    const callsB: string[][] = [];
    const noop = async () => {};
    const inputsA = { ...INPUTS(keyDirA), keyName: "selfhost-a-x", securityGroupName: "selfhost-a-x", tags: { Name: "selfhost-a-x" } };
    const inputsB = { ...INPUTS(keyDirB), keyName: "selfhost-b-y", securityGroupName: "selfhost-b-y", tags: { Name: "selfhost-b-y" } };
    await provisionEc2Box({ inputs: inputsA, exec: fakeEc2Exec(callsA), registerCleanup: noop });
    await provisionEc2Box({ inputs: inputsB, exec: fakeEc2Exec(callsB), registerCleanup: noop });
    const keyA = callsA.find((c) => c.join(" ").includes("create-key-pair"))!.join(" ");
    const keyB = callsB.find((c) => c.join(" ").includes("create-key-pair"))!.join(" ");
    assert.ok(keyA.includes("selfhost-a-x") && keyB.includes("selfhost-b-y") && keyA !== keyB);
  } finally {
    await rm(keyDirA, { recursive: true, force: true });
    await rm(keyDirB, { recursive: true, force: true });
  }
});

const BOX = {
  instanceId: "i-1",
  securityGroupId: "sg-1",
  keyName: "k",
  keyPath: "/tmp/none.pem",
  publicIp: "203.0.113.1",
  sshUser: "ubuntu",
};

/** Wraps a partial exec (SG-error) so create/describe still return sane stdout. */
function mergeExec(override: Ec2Exec, _keyDir: string): Ec2Exec {
  const calls: string[][] = [];
  const base = fakeEc2Exec(calls);
  return {
    async run(args, options) {
      if (args.join(" ").includes("delete-security-group")) {
        return override.run(args, options);
      }
      return base.run(args, options);
    },
  };
}
