import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_STACK_EVENT_TAIL,
  SelfHostCfnCleanupStack,
  boundedStackEventsTail,
  buildCfnParameters,
  bundleDigestBound,
  cfnSiteAddress,
  cfnStackName,
  createCfnStackAndWait,
  deleteGhcrPackageVersion,
  describeStackEventsTail,
  digestSha256,
  ghcrVersionIdForTag,
  imageDigestBound,
  outputsWellFormed,
  parseGhcrRepo,
  parseGhcrVersions,
  parseStackOutputs,
  pushCandidateServerImage,
  runScopedImageTag,
  s3KeyPrefix,
  ssmInspectRunningImageDigest,
  templateFileSha256,
  uploadBundleAndPresign,
  validateTemplate,
  type CfnAwsExec,
  type DockerExec,
  type GhExec,
} from "./cfn.js";
import type { CleanupLedger, CleanupLedgerEntry, CleanupResourceKind } from "../local-workspace/cleanup-ledger.js";

// ── Fakes ────────────────────────────────────────────────────────────────────

/** Records argv and returns canned stdout via a routing handler. */
class FakeExec implements CfnAwsExec, DockerExec, GhExec {
  calls: string[][] = [];
  constructor(private readonly handler: (args: string[]) => string) {}
  async run(args: readonly string[]): Promise<string> {
    const copy = [...args];
    this.calls.push(copy);
    return this.handler(copy);
  }
}

function fakeLedger(): CleanupLedger {
  const entries: CleanupLedgerEntry[] = [];
  const find = (id: string) => entries.find((entry) => entry.entryId === id);
  return {
    ledgerId: "run-1:shard-1",
    async registerIntent(kind: CleanupResourceKind, entryId: string) {
      const entry: CleanupLedgerEntry = {
        entryId,
        kind,
        phase: "intent",
        providerId: null,
        createdAt: "t",
        updatedAt: "t",
      };
      entries.push(entry);
      return { ...entry };
    },
    async markAcquired(entryId, providerId) {
      const entry = find(entryId);
      if (entry) {
        entry.providerId = providerId;
        entry.phase = "acquired";
      }
    },
    async markReconciled(entryId) {
      const entry = find(entryId);
      if (entry) {
        entry.phase = "reconciled";
      }
    },
    entries: () => entries.map((entry) => ({ ...entry })),
    unreconciled: () => entries.filter((entry) => entry.phase !== "reconciled").map((entry) => ({ ...entry })).reverse(),
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

test("cfnStackName: deterministic, CFN-safe, ≤128, collision-free digest suffix", () => {
  const a = cfnStackName("run-1", "shard-0");
  const b = cfnStackName("run-1", "shard-0");
  const c = cfnStackName("run-1", "shard-1");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[A-Za-z][-A-Za-z0-9]*$/);
  assert.ok(a.length <= 128);
});

test("runScopedImageTag: never rolling, docker-tag-safe", () => {
  const tag = runScopedImageTag("Run/ID_1", "Shard 0");
  assert.match(tag, /^[a-z0-9_.-]+$/);
  assert.notEqual(tag, "stable");
  assert.notEqual(tag, "latest");
});

test("s3KeyPrefix + cfnSiteAddress: run-scoped prefix + owned-zone FQDN", () => {
  assert.equal(s3KeyPrefix("run-1", "shard-0"), "qualification/run-1/shard-0/");
  assert.equal(cfnSiteAddress("sh-abc"), "sh-abc.qualification.proliferate.com");
});

test("parseGhcrRepo: splits org + package name; rejects a bare repo", () => {
  assert.deepEqual(parseGhcrRepo("ghcr.io/proliferate-ai/proliferate-server-qualification"), {
    org: "proliferate-ai",
    packageName: "proliferate-server-qualification",
  });
  assert.throws(() => parseGhcrRepo("ghcr.io/onlyorg"), /ghcr\.io/);
});

test("buildCfnParameters: emits all 7 candidate parameters incl. CreateRoute53Record=true", () => {
  const params = buildCfnParameters({
    releaseVersion: "1.2.3",
    serverImageRepository: "ghcr.io/proliferate-ai/proliferate-server-qualification",
    deployBundleUrl: "https://s3/presigned-bundle",
    deployBundleChecksumUrl: "https://s3/presigned-sums",
    siteAddress: "sh-x.qualification.proliferate.com",
    hostedZoneId: "Z123",
  });
  assert.ok(params.includes("ParameterKey=ReleaseVersion,ParameterValue=1.2.3"));
  assert.ok(params.includes("ParameterKey=CreateRoute53Record,ParameterValue=true"));
  assert.ok(params.includes("ParameterKey=HostedZoneId,ParameterValue=Z123"));
  assert.ok(params.includes("ParameterKey=DeployBundleChecksumUrl,ParameterValue=https://s3/presigned-sums"));
  assert.equal(params.length, 7);
});

test("parseStackOutputs: reads BaseUrl/SiteAddress/InstanceId; throws when missing", () => {
  const json = JSON.stringify({
    Stacks: [
      {
        Outputs: [
          { OutputKey: "BaseUrl", OutputValue: "https://sh-x.qualification.proliferate.com" },
          { OutputKey: "SiteAddress", OutputValue: "sh-x.qualification.proliferate.com" },
          { OutputKey: "InstanceId", OutputValue: "i-0abc123" },
          { OutputKey: "PublicIp", OutputValue: "1.2.3.4" },
        ],
      },
    ],
  });
  const outputs = parseStackOutputs(json);
  assert.equal(outputs.baseUrl, "https://sh-x.qualification.proliferate.com");
  assert.equal(outputs.instanceId, "i-0abc123");
  assert.equal(outputs.publicIp, "1.2.3.4");
  assert.throws(() => parseStackOutputs(JSON.stringify({ Stacks: [{ Outputs: [] }] })), /missing/);
});

test("outputsWellFormed: requires BaseUrl==https://SiteAddress and an i- instance id", () => {
  const site = "sh-x.qualification.proliferate.com";
  assert.equal(
    outputsWellFormed({ baseUrl: `https://${site}`, siteAddress: site, instanceId: "i-0abc" }, site),
    true,
  );
  assert.equal(outputsWellFormed({ baseUrl: `http://${site}`, siteAddress: site, instanceId: "i-0abc" }, site), false);
  assert.equal(outputsWellFormed({ baseUrl: `https://${site}`, siteAddress: site, instanceId: "nope" }, site), false);
  assert.equal(outputsWellFormed({ baseUrl: `https://${site}`, siteAddress: "other", instanceId: "i-0abc" }, site), false);
});

test("digestSha256 + imageDigestBound: compares the sha256 component across refs", () => {
  const sha = `sha256:${"a".repeat(64)}`;
  assert.equal(digestSha256(`ghcr.io/x/y@${sha}`), sha);
  assert.equal(digestSha256("no-digest-here"), null);
  assert.equal(imageDigestBound(`ghcr.io/x/y@${sha}`, `ghcr.io/x/y@${sha}`), true);
  assert.equal(imageDigestBound(`ghcr.io/x/y@${sha}`, `ghcr.io/x/y@sha256:${"b".repeat(64)}`), false);
  assert.equal(imageDigestBound("nodigest", `ghcr.io/x/y@${sha}`), false);
});

test("bundleDigestBound: true iff the sums list the candidate bundle sha for proliferate-deploy.tar.gz", () => {
  const sha = "a".repeat(64);
  assert.equal(bundleDigestBound(`${sha}  proliferate-deploy.tar.gz\n`, sha), true);
  assert.equal(bundleDigestBound(`${sha} *proliferate-deploy.tar.gz\n`, sha), true);
  assert.equal(bundleDigestBound(`${"b".repeat(64)}  proliferate-deploy.tar.gz\n`, sha), false);
  assert.equal(bundleDigestBound(`${sha}  some-other-file.tar.gz\n`, sha), false);
  assert.equal(bundleDigestBound("garbage", sha), false);
});

test("boundedStackEventsTail: only FAILED events, bounded count, secret-free formatting", () => {
  const events = Array.from({ length: 20 }, (_, i) => ({
    LogicalResourceId: `R${i}`,
    ResourceStatus: i % 2 === 0 ? "CREATE_FAILED" : "CREATE_COMPLETE",
    ResourceStatusReason: `reason ${i}`,
  }));
  const tail = boundedStackEventsTail(JSON.stringify({ StackEvents: events }));
  assert.ok(!tail.includes("CREATE_COMPLETE"), "only FAILED events are kept");
  const parts = tail.split(" | ");
  assert.ok(parts.length <= MAX_STACK_EVENT_TAIL);
  assert.equal(boundedStackEventsTail("not json"), "(stack events unavailable)");
  assert.equal(boundedStackEventsTail(JSON.stringify({ StackEvents: [] })), "(no FAILED stack events)");
});

test("parseGhcrVersions + ghcrVersionIdForTag: finds the version whose tags include the run tag", () => {
  const page1 = JSON.stringify([
    { id: 11, metadata: { container: { tags: ["stable"] } } },
    { id: 22, metadata: { container: { tags: ["run-1-shard-0"] } } },
  ]);
  const page2 = JSON.stringify([{ id: 33, metadata: { container: { tags: [] } } }]);
  const versions = parseGhcrVersions(page1 + page2);
  assert.equal(versions.length, 3);
  assert.equal(ghcrVersionIdForTag(versions, "run-1-shard-0"), 22);
  assert.equal(ghcrVersionIdForTag(versions, "absent"), null);
});

// ── S3 upload / presign ──────────────────────────────────────────────────────

test("uploadBundleAndPresign: registers s3_object BEFORE each cp, returns presigned URLs", async () => {
  const log: string[] = [];
  const exec = new FakeExec((args) => {
    if (args[0] === "s3" && args[1] === "cp") {
      log.push(`cp:${args[3]}`);
      return "";
    }
    if (args[0] === "s3" && args[1] === "presign") {
      return `https://s3/presigned/${encodeURIComponent(args[2])}`;
    }
    return "";
  });
  const result = await uploadBundleAndPresign({
    exec,
    region: "us-east-1",
    bucket: "bkt",
    keyPrefix: "qualification/run-1/shard-0/",
    bundlePath: "/tmp/proliferate-deploy.tar.gz",
    sumsPath: "/tmp/self-hosted-assets.SHA256SUMS",
    registerCleanup: async (kind, providerId) => {
      log.push(`register:${kind}:${providerId}`);
    },
  });
  // Registered-before-create: each s3_object intent precedes its cp.
  const bundleReg = log.indexOf("register:s3_object:s3://bkt/qualification/run-1/shard-0/proliferate-deploy.tar.gz");
  const bundleCp = log.indexOf("cp:s3://bkt/qualification/run-1/shard-0/proliferate-deploy.tar.gz");
  assert.ok(bundleReg >= 0 && bundleReg < bundleCp, `register precedes cp (${JSON.stringify(log)})`);
  assert.ok(result.deployBundleUrl.startsWith("https://s3/presigned/"));
  assert.ok(result.deployBundleChecksumUrl.startsWith("https://s3/presigned/"));
  assert.equal(result.bundleKey, "qualification/run-1/shard-0/proliferate-deploy.tar.gz");
});

// ── Image push + GHCR delete ─────────────────────────────────────────────────

test("pushCandidateServerImage: registers ghcr BEFORE push, tags+pushes, returns pushed digest", async () => {
  const sha = `sha256:${"c".repeat(64)}`;
  const log: string[] = [];
  const docker = new FakeExec((args) => {
    log.push(`docker:${args[0]}`);
    if (args[0] === "load") {
      return "Loaded image: proliferate-server-qualification:1.2.3\n";
    }
    if (args[0] === "inspect") {
      return `ghcr.io/proliferate-ai/proliferate-server-qualification@${sha}\n`;
    }
    return "";
  });
  const gh = new FakeExec(() => "");
  const result = await pushCandidateServerImage({
    docker,
    gh,
    archivePath: "/tmp/server-image.tar",
    targetRepo: "ghcr.io/proliferate-ai/proliferate-server-qualification",
    tag: "run-1-shard-0",
    registerCleanup: async (kind, providerId) => {
      log.push(`register:${kind}:${providerId}`);
    },
  });
  const reg = log.indexOf("register:ghcr_package_version:ghcr.io/proliferate-ai/proliferate-server-qualification:run-1-shard-0");
  const push = log.indexOf("docker:push");
  assert.ok(reg >= 0 && reg < push, `ghcr register precedes push (${JSON.stringify(log)})`);
  assert.equal(result.pushedDigest, sha);
  assert.equal(result.imageRef, "ghcr.io/proliferate-ai/proliferate-server-qualification:run-1-shard-0");
});

test("pushCandidateServerImage: refuses a rolling tag before touching docker", async () => {
  const docker = new FakeExec(() => "");
  const gh = new FakeExec(() => "");
  await assert.rejects(
    pushCandidateServerImage({
      docker,
      gh,
      archivePath: "/tmp/a.tar",
      targetRepo: "ghcr.io/x/y",
      tag: "latest",
      registerCleanup: async () => undefined,
    }),
    /rolling tag/,
  );
  assert.equal(docker.calls.length, 0);
});

test("deleteGhcrPackageVersion: resolves the version id by tag then DELETEs the exact endpoint", async () => {
  const gh = new FakeExec((args) => {
    if (args.includes("--paginate")) {
      return JSON.stringify([
        { id: 55, metadata: { container: { tags: ["other"] } } },
        { id: 77, metadata: { container: { tags: ["run-1-shard-0"] } } },
      ]);
    }
    return "";
  });
  await deleteGhcrPackageVersion(gh, "ghcr.io/proliferate-ai/proliferate-server-qualification", "run-1-shard-0");
  const del = gh.calls.find((call) => call.includes("DELETE"));
  assert.ok(del, "a DELETE call was made");
  assert.deepEqual(del, [
    "api",
    "--method",
    "DELETE",
    "/orgs/proliferate-ai/packages/container/proliferate-server-qualification/versions/77",
  ]);
});

test("deleteGhcrPackageVersion: idempotent when the tag is already gone (no DELETE)", async () => {
  const gh = new FakeExec(() => JSON.stringify([{ id: 1, metadata: { container: { tags: ["stable"] } } }]));
  await deleteGhcrPackageVersion(gh, "ghcr.io/x/y", "run-1-shard-0");
  assert.ok(!gh.calls.some((call) => call.includes("DELETE")));
});

// ── CloudFormation stack ──────────────────────────────────────────────────────

test("validateTemplate + templateFileSha256: validate + a stable byte hash", async () => {
  const exec = new FakeExec(() => "");
  assert.equal(await validateTemplate(exec, "/repo/template.yaml", "us-east-1"), true);
  assert.ok(exec.calls[0].includes("validate-template"));
  // Hash this test file itself (a real, readable path) — deterministic 64-hex.
  const hash = await templateFileSha256(new URL(import.meta.url).pathname);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("createCfnStackAndWait: registers stack BEFORE create, passes params, returns parsed outputs", async () => {
  const site = "sh-x.qualification.proliferate.com";
  const log: string[] = [];
  const exec = new FakeExec((args) => {
    if (args[1] === "create-stack") {
      log.push("create");
      assert.ok(args.includes("CAPABILITY_IAM"));
      assert.ok(args.includes("ParameterKey=CreateRoute53Record,ParameterValue=true"));
      return "";
    }
    if (args[1] === "wait") {
      return "";
    }
    if (args[1] === "describe-stacks") {
      return JSON.stringify({
        Stacks: [
          {
            Outputs: [
              { OutputKey: "BaseUrl", OutputValue: `https://${site}` },
              { OutputKey: "SiteAddress", OutputValue: site },
              { OutputKey: "InstanceId", OutputValue: "i-0abc" },
            ],
          },
        ],
      });
    }
    return "";
  });
  const outputs = await createCfnStackAndWait({
    exec,
    stackName: "proliferate-sh-cfn-x",
    templatePath: "/repo/template.yaml",
    parameters: buildCfnParameters({
      releaseVersion: "1.2.3",
      serverImageRepository: "ghcr.io/x/y",
      deployBundleUrl: "https://s3/b",
      deployBundleChecksumUrl: "https://s3/s",
      siteAddress: site,
      hostedZoneId: "Z1",
    }),
    region: "us-east-1",
    registerCleanup: async (kind) => {
      log.push(`register:${kind}`);
    },
  });
  assert.ok(log.indexOf("register:cloudformation_stack") < log.indexOf("create"));
  assert.equal(outputs.instanceId, "i-0abc");
});

test("createCfnStackAndWait: a create-complete wait failure tails describe-stack-events (bounded)", async () => {
  const exec = new FakeExec((args) => {
    if (args[1] === "wait") {
      throw new Error("Waiter StackCreateComplete failed: ROLLBACK");
    }
    if (args[1] === "describe-stack-events") {
      return JSON.stringify({
        StackEvents: [
          {
            LogicalResourceId: "ProliferateInstance",
            ResourceStatus: "CREATE_FAILED",
            ResourceStatusReason: "Received FAILURE signal",
          },
        ],
      });
    }
    return "";
  });
  await assert.rejects(
    createCfnStackAndWait({
      exec,
      stackName: "stk",
      templatePath: "/t.yaml",
      parameters: [],
      region: "us-east-1",
      registerCleanup: async () => undefined,
    }),
    /ProliferateInstance CREATE_FAILED/,
  );
});

test("describeStackEventsTail: returns the bounded formatter output", async () => {
  const exec = new FakeExec(() =>
    JSON.stringify({ StackEvents: [{ LogicalResourceId: "X", ResourceStatus: "DELETE_FAILED", ResourceStatusReason: "boom" }] }),
  );
  assert.equal(await describeStackEventsTail(exec, "stk", "us-east-1"), "X DELETE_FAILED: boom");
});

// ── SSM digest readback ───────────────────────────────────────────────────────

test("ssmInspectRunningImageDigest: send-command then poll to Success returns the sha256 digest", async () => {
  const sha = `sha256:${"d".repeat(64)}`;
  let polls = 0;
  const exec = new FakeExec((args) => {
    if (args[1] === "send-command") {
      return "cmd-123\n";
    }
    if (args[1] === "get-command-invocation") {
      polls += 1;
      const status = polls < 2 ? "InProgress" : "Success";
      return JSON.stringify({ Status: status, StandardOutputContent: `ghcr.io/x/y@${sha}\n` });
    }
    return "";
  });
  const digest = await ssmInspectRunningImageDigest({
    exec,
    instanceId: "i-0abc",
    region: "us-east-1",
    pollTimeoutMs: 5_000,
  });
  assert.equal(digest, sha);
});

test("ssmInspectRunningImageDigest: a terminal Failed status throws (so the cell's fallback engages)", async () => {
  const exec = new FakeExec((args) => {
    if (args[1] === "send-command") {
      return "cmd-1\n";
    }
    if (args[1] === "get-command-invocation") {
      return JSON.stringify({ Status: "Failed", StandardOutputContent: "" });
    }
    return "";
  });
  await assert.rejects(
    ssmInspectRunningImageDigest({ exec, instanceId: "i-0abc", region: "us-east-1", pollTimeoutMs: 5_000 }),
    /terminal status Failed/,
  );
});

// ── Cleanup stack ─────────────────────────────────────────────────────────────

test("SelfHostCfnCleanupStack: reverse-order teardown, route53 rides the stack, green requires all", async () => {
  const order: string[] = [];
  const stack = new SelfHostCfnCleanupStack({ ledger: fakeLedger() });
  // Registration order: local paths → s3 → ghcr → stack (reverse teardown =
  // stack first, local paths last).
  await stack.registerAcquire("run_directory", "/run/cfn", async () => void order.push("run_directory"));
  await stack.registerAcquire("extracted_artifacts", "/run/cfn/artifacts", async () => void order.push("extracted_artifacts"));
  await stack.registerAcquire("s3_object", "s3://b/bundle", async () => void order.push("s3_bundle"));
  await stack.registerAcquire("s3_object", "s3://b/sums", async () => void order.push("s3_sums"));
  await stack.registerAcquire("ghcr_package_version", "ghcr:tag", async () => void order.push("ghcr"));
  await stack.registerAcquire("cloudformation_stack", "stk", async () => void order.push("stack"));

  const evidence = await stack.runAll();
  assert.deepEqual(order, ["stack", "ghcr", "s3_sums", "s3_bundle", "extracted_artifacts", "run_directory"]);
  assert.equal(evidence.registered, 6);
  assert.equal(evidence.reconciled, 6);
  assert.equal(evidence.failed, 0);
  assert.equal(evidence.stackDeleted, true);
  assert.equal(evidence.s3ObjectsDeleted, true);
  assert.equal(evidence.ghcrVersionDeleted, true);
  assert.equal(evidence.route53RecordDeleted, true); // rides stackDeleted
  assert.equal(evidence.localPathsRemoved, true);
  assert.match(evidence.ledgerIdHash, /^[0-9a-f]{64}$/);
});

test("SelfHostCfnCleanupStack: a stack-delete failure drags stackDeleted AND route53RecordDeleted false", async () => {
  const stack = new SelfHostCfnCleanupStack({ ledger: fakeLedger() });
  await stack.registerAcquire("run_directory", "/run/cfn", async () => undefined);
  await stack.registerAcquire("s3_object", "s3://b/o", async () => undefined);
  await stack.registerAcquire("ghcr_package_version", "ghcr:tag", async () => undefined);
  await stack.registerAcquire("cloudformation_stack", "stk", async () => {
    throw new Error("delete-stack timed out");
  });
  const evidence = await stack.runAll();
  // The stack delete failed (1); its failure then also preserves the
  // run_directory releaser (+1), so failed is 2 — both are honest leaks.
  assert.ok(evidence.failed >= 1);
  assert.equal(evidence.stackDeleted, false);
  assert.equal(evidence.route53RecordDeleted, false);
  // The other AWS categories still reconciled.
  assert.equal(evidence.s3ObjectsDeleted, true);
  assert.equal(evidence.ghcrVersionDeleted, true);
});

test("SelfHostCfnCleanupStack: run_directory releaser is preserved when an earlier releaser failed", async () => {
  let runDirDeleted = false;
  const stack = new SelfHostCfnCleanupStack({ ledger: fakeLedger() });
  await stack.registerAcquire("run_directory", "/run/cfn", async () => {
    runDirDeleted = true;
  });
  await stack.registerAcquire("cloudformation_stack", "stk", async () => {
    throw new Error("delete failed");
  });
  const evidence = await stack.runAll();
  assert.equal(runDirDeleted, false, "run directory preserved so the ledger survives for replay");
  assert.equal(evidence.localPathsRemoved, false);
  assert.ok(evidence.failed >= 1);
});
