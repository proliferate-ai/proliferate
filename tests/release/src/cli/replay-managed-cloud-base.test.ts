import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { FetchLike } from "../services/qualification-litellm.js";
import { openCleanupLedger } from "../worlds/local-workspace/cleanup-ledger.js";
import {
  replayManagedCloudBaseWorld,
  type BaseWorldReplayDeps,
} from "../worlds/managed-cloud/base-world-replay.js";
import { captureHostProcessCustody, type HostProcessCustodyDeps } from "../worlds/managed-cloud/host-process-custody.js";
import {
  markSharedTemplateAcquired,
  markSharedTemplateReleased,
  recordSharedTemplateIntent,
  sharedTemplateCustodyPath,
} from "../worlds/managed-cloud/shared-template-custody.js";
import type { E2bTemplateReceipt } from "../worlds/managed-cloud/template.js";
import { parseReplayManagedCloudBaseArgs } from "./replay-managed-cloud-base.js";

const RUN = "run-1";
const SHARD = "shard-1";
const REGION = "us-west-2";
const ZONE = "ZQUAL";

function response(status: number, payload: unknown = {}): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

function tagged(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    Tags: [
      { Key: "Purpose", Value: "managed-cloud-qualification" },
      { Key: "RunId", Value: RUN },
      { Key: "ShardId", Value: SHARD },
    ],
    ...extra,
  };
}

function processDeps(marker: string): { deps: HostProcessCustodyDeps; encoded: Promise<string | null>; signals: string[] } {
  const row = {
    pid: 44, parentPid: 1, starttime: "99", executable: "/usr/bin/node",
    argv: ["node", marker],
  };
  const live = new Map([[44, row]]);
  const signals: string[] = [];
  const deps: HostProcessCustodyDeps = {
    async readProcess(pid) { return live.get(pid) ?? null; },
    async listProcesses() { return [...live.values()]; },
    signal(pid, signal) { signals.push(`${pid}:${signal}`); live.delete(pid); },
    async sleep() {},
  };
  return { deps, encoded: captureHostProcessCustody(44, marker, deps), signals };
}

test("replays exact run-owned AWS, LiteLLM, process, and local resources from the ledger", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "base-replay-"));
  const runDir = path.join(parent, "cloud-provision-1");
  await mkdir(path.join(runDir, "secrets"), { recursive: true });
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN, shardId: SHARD });
    const acquire = async (kind: Parameters<typeof ledger.registerIntent>[0], id: string, providerId: string) => {
      await ledger.registerIntent(kind, id);
      await ledger.markAcquired(id, providerId);
    };
    await acquire("run_directory", "run-dir", runDir);
    await acquire("port_registration", "port", "mcq-run-1-shard-1.qualification.proliferate.com");
    await acquire("secret_env_file", "secrets", path.join(runDir, "secrets"));
    await acquire("key_pair", "key", "mcq-run-1-shard-1-key");
    await acquire("security_group", "sg", "sg-1");
    await acquire("ec2_instance", "instance", "i-1");
    // Route53 has no provider tags, so the pre-create intent deliberately has
    // no provider id. Replay derives the one exact run/shard-owned FQDN.
    await ledger.registerIntent("route53_record", "dns");
    await acquire("litellm_team", "team", "team-1");
    await acquire("litellm_user", "user", "user-1");
    await acquire("litellm_virtual_key", "key-v", "key-alias:vk-user-u1-e1");
    const templateIdentity = {
      runId: RUN,
      shardId: SHARD,
      sourceSha: "a".repeat(40),
      templateName: "proliferate-runtime-qual-run-1",
      inputHash: "b".repeat(64),
    };
    const templateReceipt: E2bTemplateReceipt = {
      artifact_id: "e2b-template/proliferate-runtime-qual-run-1",
      templateId: "tmpl-1",
      buildId: "build-1",
      inputHash: "b".repeat(64),
      bakedInputs: [
        { destination: "/home/user/anyharness", sha256: "1".repeat(64) },
        { destination: "/home/user/.proliferate/bin/proliferate-worker", sha256: "2".repeat(64) },
        { destination: "/home/user/.proliferate/bin/proliferate-supervisor", sha256: "3".repeat(64) },
        { destination: "/home/user/.proliferate/bin/proliferate-git-credential-helper", sha256: "4".repeat(64) },
      ],
    };
    const custodyPath = sharedTemplateCustodyPath(parent);
    await recordSharedTemplateIntent(custodyPath, templateIdentity);
    await markSharedTemplateAcquired(custodyPath, templateIdentity, templateReceipt);
    await markSharedTemplateReleased(custodyPath, templateIdentity, templateReceipt);
    await acquire("e2b_template", "template", "tmpl-1");
    const proc = processDeps(path.join(runDir, "renderer"));
    await acquire("renderer_process", "renderer", (await proc.encoded)!);

    const awsCalls: string[][] = [];
    let dnsPresent = true;
    let keyPresent = true;
    let userPresent = true;
    let teamPresent = true;
    const deps: BaseWorldReplayDeps = {
      process: proc.deps,
      async sleep() {},
      async awsExec(_file, args) {
        awsCalls.push([...args]);
        const op = `${args[0]} ${args[1]}`;
        if (op === "ec2 describe-instances") return { stdout: JSON.stringify({ Reservations: [{ Instances: [tagged({ InstanceId: "i-1", State: { Name: "running" } })] }] }), stderr: "" };
        if (op === "ec2 describe-security-groups") return { stdout: JSON.stringify({ SecurityGroups: [tagged({ GroupId: "sg-1" })] }), stderr: "" };
        if (op === "ec2 describe-key-pairs") return { stdout: JSON.stringify({ KeyPairs: [tagged({ KeyName: "mcq-run-1-shard-1-key" })] }), stderr: "" };
        if (op === "route53 list-resource-record-sets") return { stdout: JSON.stringify({ ResourceRecordSets: dnsPresent ? [{ Name: "mcq-run-1-shard-1.qualification.proliferate.com.", Type: "A", TTL: 60, ResourceRecords: [{ Value: "192.0.2.1" }] }] : [] }), stderr: "" };
        if (op === "route53 change-resource-record-sets") dnsPresent = false;
        return { stdout: "{}", stderr: "" };
      },
      fetch: async (url, init) => {
        if (url.includes("/key/list")) {
          return response(200, { keys: keyPresent ? [{ key_alias: "vk-user-u1-e1", token: "tok-1" }] : [] });
        }
        assert.equal(init?.headers?.authorization, "Bearer master");
        if (url.endsWith("/key/delete")) keyPresent = false;
        if (url.endsWith("/user/delete")) userPresent = false;
        if (url.endsWith("/team/delete")) teamPresent = false;
        if (url.includes("/user/info")) return response(userPresent ? 200 : 404, { user_id: "user-1" });
        if (url.includes("/team/list")) return response(200, teamPresent ? [{ team_id: "team-1" }] : []);
        return response(200, { deleted: true });
      },
    };
    const report = await replayManagedCloudBaseWorld({
      runDir, runId: RUN, shardId: SHARD, region: REGION, hostedZoneId: ZONE,
      litellmBaseUrl: "https://litellm.example", litellmMasterKey: "master",
    }, deps);
    assert.equal(report.status, "reconciled");
    assert.equal(report.removed_run_directory, true);
    assert.ok(awsCalls.some((args) => args.includes("terminate-instances")));
    const operationIndex = (service: string, operation: string): number =>
      awsCalls.findIndex((args) => args[0] === service && args[1] === operation);
    const terminate = operationIndex("ec2", "terminate-instances");
    const wait = operationIndex("ec2", "wait");
    const deleteGroup = operationIndex("ec2", "delete-security-group");
    const deleteKey = operationIndex("ec2", "delete-key-pair");
    assert.ok(terminate >= 0 && wait > terminate);
    assert.ok(deleteGroup > wait, "security group deletion must follow instance termination/wait");
    assert.ok(deleteKey > deleteGroup, "key-pair deletion must follow security-group deletion");
    assert.deepEqual(proc.signals, ["44:SIGTERM"]);
    const journal = JSON.parse(await readFile(path.join(parent, "cleanup-replay", "cloud-provision-1.json"), "utf8"));
    assert.equal(journal.state, "released");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("an independent domain failure leaves its ledger entry non-green while later domains run", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "base-replay-fail-"));
  const runDir = path.join(parent, "fixture-smoke");
  await mkdir(runDir, { recursive: true });
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN, shardId: SHARD });
    await ledger.registerIntent("litellm_team", "team");
    await ledger.markAcquired("team", "team-1");
    await ledger.registerIntent("port_registration", "port");
    await ledger.markAcquired("port", "mcq-run-1-shard-1.qualification.proliferate.com");
    await assert.rejects(() => replayManagedCloudBaseWorld({
      runDir, runId: RUN, shardId: SHARD, region: REGION, hostedZoneId: ZONE,
      litellmBaseUrl: "https://litellm.example", litellmMasterKey: "master",
    }, {
      async awsExec() { return { stdout: "{}", stderr: "" }; },
      fetch: async () => response(500),
    }), /litellm_team/);
    const persisted = JSON.parse(await readFile(path.join(runDir, "cleanup-ledger.json"), "utf8"));
    assert.equal(persisted.entries.find((row: { entryId: string }) => row.entryId === "team").phase, "acquired");
    assert.equal(persisted.entries.find((row: { entryId: string }) => row.entryId === "port").phase, "reconciled");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a missing LiteLLM team identity stays non-green and is never sent to the provider", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "base-replay-missing-team-"));
  const runDir = path.join(parent, "fixture-smoke");
  await mkdir(runDir, { recursive: true });
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN, shardId: SHARD });
    await ledger.registerIntent("litellm_team", "team");
    await ledger.markAcquired("team", "missing-team:user-1");
    let providerCalls = 0;
    await assert.rejects(() => replayManagedCloudBaseWorld({
      runDir, runId: RUN, shardId: SHARD, region: "", hostedZoneId: "",
      litellmBaseUrl: "https://litellm.example", litellmMasterKey: "master",
    }, {
      async awsExec() { return { stdout: "{}", stderr: "" }; },
      fetch: async () => { providerCalls += 1; return response(200); },
    }), /cleanup identity is malformed/);
    assert.equal(providerCalls, 0);
    const persisted = JSON.parse(await readFile(path.join(runDir, "cleanup-ledger.json"), "utf8"));
    assert.equal(persisted.entries[0].phase, "acquired");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("an accepted LiteLLM delete that remains visible stays unreconciled", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "base-replay-visible-team-"));
  const runDir = path.join(parent, "fixture-smoke");
  await mkdir(runDir, { recursive: true });
  try {
    const ledger = await openCleanupLedger({ runDir, runId: RUN, shardId: SHARD });
    await ledger.registerIntent("litellm_team", "team");
    await ledger.markAcquired("team", "team-1");
    let probes = 0;
    await assert.rejects(() => replayManagedCloudBaseWorld({
      runDir, runId: RUN, shardId: SHARD, region: "", hostedZoneId: "",
      litellmBaseUrl: "https://litellm.example", litellmMasterKey: "master",
    }, {
      async awsExec() { return { stdout: "{}", stderr: "" }; },
      async sleep() {},
      fetch: async (url) => {
        if (url.includes("/team/list")) {
          probes += 1;
          return response(200, [{ team_id: "team-1" }]);
        }
        return response(200, { deleted: true });
      },
    }), /remains visible/);
    assert.equal(probes, 3);
    const persisted = JSON.parse(await readFile(path.join(runDir, "cleanup-ledger.json"), "utf8"));
    assert.equal(persisted.entries[0].phase, "acquired");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("an interrupted run-directory journal removes the exact directory before release", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "base-replay-dir-journal-"));
  const runDir = path.join(parent, "fixture-smoke");
  const replayDir = path.join(parent, "cleanup-replay");
  await mkdir(runDir, { recursive: true });
  await mkdir(replayDir, { recursive: true });
  try {
    await writeFile(path.join(runDir, "left-behind"), "owned");
    await writeFile(path.join(replayDir, "fixture-smoke.json"), JSON.stringify({
      schema_version: 1,
      run_id: RUN,
      shard_id: SHARD,
      world_dir: "fixture-smoke",
      ledger_id: `${RUN}:${SHARD}`,
      state: "intent",
    }));
    const report = await replayManagedCloudBaseWorld({
      runDir, runId: RUN, shardId: SHARD, region: "", hostedZoneId: "",
      litellmBaseUrl: "", litellmMasterKey: "",
    }, {
      async awsExec() { return { stdout: "{}", stderr: "" }; },
      fetch: async () => response(500),
    });
    assert.equal(report.removed_run_directory, true);
    await assert.rejects(() => readFile(path.join(runDir, "left-behind")), { code: "ENOENT" });
    const journal = JSON.parse(await readFile(path.join(replayDir, "fixture-smoke.json"), "utf8"));
    assert.equal(journal.state, "released");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("CLI parser binds exact run identity and protected service inputs", () => {
  const parsed = parseReplayManagedCloudBaseArgs([
    "--run-dir", "/tmp/x/cloud-provision-1", "--run-id", RUN, "--shard-id", SHARD,
  ], {
    RELEASE_E2E_CLOUD_AWS_REGION: REGION,
    RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: ZONE,
    AGENT_GATEWAY_LITELLM_BASE_URL: "https://litellm.example",
    AGENT_GATEWAY_LITELLM_MASTER_KEY: "master",
  });
  assert.equal(parsed.runId, RUN);
  assert.equal(parsed.hostedZoneId, ZONE);

  const lazy = parseReplayManagedCloudBaseArgs([
    "--run-dir", "/tmp/x/cloud-provision-1", "--run-id", RUN, "--shard-id", SHARD,
  ], {});
  assert.equal(lazy.region, "");
  assert.equal(lazy.litellmMasterKey, "");
});
