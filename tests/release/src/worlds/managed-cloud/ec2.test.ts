import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openCleanupLedger } from "../local-workspace/cleanup-ledger.js";
import { ManagedCloudCleanupStack } from "./cleanup-kinds.js";
import {
  AwsCliEc2Provisioner,
  provisionRunIngress,
  type AwsCliExec,
  type Ec2CleanupKind,
  type Ec2ProvisionConfig,
  type Ec2Provisioner,
  type Ec2ResourceTags,
} from "./ec2.js";

const CONFIG: Ec2ProvisionConfig = {
  region: "us-east-1",
  hostedZoneId: "Z123QUALIFICATION",
  zoneName: "qualification.proliferate.com",
  instanceType: "t3.small",
  imageRef: "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id",
};

const TAGS: Ec2ResourceTags = { purpose: "managed-cloud-qualification", runId: "run-1", shardId: "shard-0" };

function fakeAwsExec(calls: string[][]): AwsCliExec {
  return async (file, args) => {
    calls.push([file, ...args]);
    const joined = args.join(" ");
    if (file === "curl") return { stdout: "203.0.113.7\n", stderr: "" };
    if (joined.includes("create-key-pair")) {
      return { stdout: "-----BEGIN KEY-----\nsecret-material\n-----END KEY-----\n", stderr: "" };
    }
    if (joined.includes("create-security-group")) return { stdout: "sg-abc123\n", stderr: "" };
    if (joined.includes("run-instances")) return { stdout: "i-0abcdef\n", stderr: "" };
    if (joined.includes("describe-instances")) return { stdout: "203.0.113.9\n", stderr: "" };
    if (joined.includes("get-parameters")) return { stdout: "ami-01234567\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
}

test("createKeyPair writes a 0600 key file and never puts the key material in argv", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "ec2-key-"));
  try {
    const calls: string[][] = [];
    const provisioner = new AwsCliEc2Provisioner({ exec: fakeAwsExec(calls) });
    const keyPath = path.join(runDir, "key.pem");
    await provisioner.createKeyPair(CONFIG, TAGS, "mcq-run-1-shard-0-key", keyPath);

    const mode = (await stat(keyPath)).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.match(await readFile(keyPath, "utf8"), /BEGIN KEY/);

    const create = calls.find((c) => c.includes("create-key-pair"))!;
    assert.ok(create.includes("--query") && create.includes("KeyMaterial"));
    assert.ok(create.some((arg) => arg.startsWith("ResourceType=key-pair,Tags=")));
    // The key material must never appear in argv.
    assert.ok(!create.some((arg) => arg.includes("secret-material")));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("authorizeIngress restricts SSH to the resolved runner IP and opens 80/443", async () => {
  const calls: string[][] = [];
  const provisioner = new AwsCliEc2Provisioner({ exec: fakeAwsExec(calls) });
  await provisioner.authorizeIngress(CONFIG, "sg-abc123");
  const authorize = calls.find((c) => c.includes("authorize-security-group-ingress"))!;
  const joined = authorize.join(" ");
  assert.match(joined, /FromPort=80/);
  assert.match(joined, /FromPort=443/);
  assert.match(joined, /FromPort=22,ToPort=22,IpRanges=\[\{CidrIp=203\.0\.113\.7\/32\}\]/);
});

test("runInstance resolves an SSM AMI reference and tags the instance", async () => {
  const calls: string[][] = [];
  const provisioner = new AwsCliEc2Provisioner({ exec: fakeAwsExec(calls) });
  const instanceId = await provisioner.runInstance(CONFIG, TAGS, {
    securityGroupId: "sg-abc123",
    keyName: "mcq-run-1-shard-0-key",
    userData: "#!/bin/bash\ntrue\n",
  });
  assert.equal(instanceId, "i-0abcdef");
  assert.ok(calls.some((c) => c.includes("get-parameters"))); // SSM resolve happened
  const run = calls.find((c) => c.includes("run-instances"))!;
  assert.ok(run.includes("--image-id") && run.includes("ami-01234567"));
  assert.ok(run.some((arg) => arg.startsWith("ResourceType=instance,Tags=")));
  assert.ok(run.includes("--user-data"));
});

test("waitInstanceRunning waits then returns the public IPv4", async () => {
  const calls: string[][] = [];
  const provisioner = new AwsCliEc2Provisioner({ exec: fakeAwsExec(calls) });
  const ip = await provisioner.waitInstanceRunning(CONFIG, "i-0abcdef");
  assert.equal(ip, "203.0.113.9");
  assert.ok(calls.some((c) => c.includes("wait") && c.includes("instance-running")));
  assert.ok(calls.some((c) => c.includes("describe-instances")));
});

test("route53 upsert and delete emit an A-record change batch with TTL 60", async () => {
  const calls: string[][] = [];
  const provisioner = new AwsCliEc2Provisioner({ exec: fakeAwsExec(calls) });
  const record = { recordName: "r.qualification.proliferate.com", hostedZoneId: "Z123", address: "203.0.113.9", ttl: 60 };
  await provisioner.upsertARecord(CONFIG, record);
  await provisioner.deleteARecord(CONFIG, record);
  const upsert = calls.find((c) => c.join(" ").includes('"Action":"UPSERT"'))!;
  const del = calls.find((c) => c.join(" ").includes('"Action":"DELETE"'))!;
  assert.match(upsert.join(" "), /"Type":"A".*"TTL":60/);
  assert.match(del.join(" "), /r\.qualification\.proliferate\.com/);
});

test("mutating calls refuse a production-looking resource", async () => {
  const provisioner = new AwsCliEc2Provisioner({ exec: fakeAwsExec([]) });
  await assert.rejects(
    provisioner.deleteKeyPair(CONFIG, "proliferate-prod-key"),
    /production-looking resource/,
  );
});

// ── provisionRunIngress ─────────────────────────────────────────────────────

function recordingProvisioner(events: string[], deletes: string[], publicIp = "203.0.113.9"): Ec2Provisioner {
  return {
    async createKeyPair(_c, _t, _name, keyPath) {
      events.push("create:key_pair");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(keyPath, "KEY", { mode: 0o600 });
    },
    async deleteKeyPair() {
      deletes.push("key_pair");
    },
    async createSecurityGroup() {
      events.push("create:security_group");
      return "sg-1";
    },
    async authorizeIngress() {
      events.push("authorize");
    },
    async deleteSecurityGroup() {
      deletes.push("security_group");
    },
    async runInstance() {
      events.push("create:ec2_instance");
      return "i-1";
    },
    async waitInstanceRunning() {
      return publicIp;
    },
    async waitStatusOk() {
      /* noop */
    },
    async terminateInstance() {
      deletes.push("ec2_instance");
    },
    async upsertARecord() {
      events.push("create:route53_record");
    },
    async deleteARecord() {
      deletes.push("route53_record");
    },
  };
}

async function ingressHarness(): Promise<{
  runDir: string;
  stack: ManagedCloudCleanupStack;
  register: (kind: Ec2CleanupKind, release: () => Promise<void>) => Promise<string>;
  acquired: (entryId: string, providerId: string) => Promise<void>;
  events: string[];
}> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "ec2-ingress-"));
  const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
  const stack = new ManagedCloudCleanupStack({ ledger });
  const events: string[] = [];
  // The four Ec2CleanupKind values are a subset of ManagedCloudCleanupKind, so
  // the stack accepts them directly (no cast).
  const register = async (kind: Ec2CleanupKind, release: () => Promise<void>) => {
    events.push(`intent:${kind}`);
    return stack.register(kind, release);
  };
  const acquired = async (entryId: string, providerId: string) => {
    events.push(`acquired:${providerId}`);
    await stack.acquired(entryId, providerId);
  };
  return { runDir, stack, register, acquired, events };
}

test("provisionRunIngress registers every AWS resource before creating it and returns the box + record", async () => {
  const h = await ingressHarness();
  try {
    const deletes: string[] = [];
    const provisioner = recordingProvisioner(h.events, deletes);
    const { box, record } = await provisionRunIngress({
      config: CONFIG,
      tags: TAGS,
      subdomain: "mcq-run-1-shard-0.qualification.proliferate.com",
      provisioner,
      register: h.register,
      acquired: h.acquired,
      keyPath: path.join(h.runDir, "ingress-key.pem"),
    });

    assert.equal(box.instanceId, "i-1");
    assert.equal(box.securityGroupId, "sg-1");
    assert.equal(box.publicIp, "203.0.113.9");
    assert.equal(box.sshDestination, "ubuntu@203.0.113.9");
    assert.equal(record.recordName, "mcq-run-1-shard-0.qualification.proliferate.com");
    assert.equal(record.address, "203.0.113.9");
    assert.equal(record.ttl, 60);

    // registered-before-create: each intent precedes its create.
    for (const kind of ["key_pair", "security_group", "ec2_instance", "route53_record"]) {
      const intent = h.events.indexOf(`intent:${kind}`);
      const create = h.events.indexOf(`create:${kind}`);
      assert.ok(intent >= 0 && create >= 0 && intent < create, `intent for ${kind} must precede create`);
    }

    // Reverse-order teardown deletes DNS → instance → SG → key pair.
    await h.stack.runAll();
    assert.deepEqual(deletes, ["route53_record", "ec2_instance", "security_group", "key_pair"]);
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("provisionRunIngress fails (and leaves the resources tracked for cleanup) when no public IP appears", async () => {
  const h = await ingressHarness();
  try {
    const deletes: string[] = [];
    const provisioner = recordingProvisioner(h.events, deletes, "None");
    await assert.rejects(
      provisionRunIngress({
        config: CONFIG,
        tags: TAGS,
        subdomain: "mcq-run-1-shard-0.qualification.proliferate.com",
        provisioner,
        register: h.register,
        acquired: h.acquired,
        keyPath: path.join(h.runDir, "ingress-key.pem"),
      }),
      /no usable public IPv4/,
    );
    // The key pair, SG, and instance were already registered before the failure,
    // so a reverse-order teardown still reclaims them.
    await h.stack.runAll();
    assert.deepEqual(deletes, ["ec2_instance", "security_group", "key_pair"]);
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});
