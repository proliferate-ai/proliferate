import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  MAX_STACK_EVENT_TAIL,
  SelfHostCfnCleanupStack,
  boundedStackEventsTail,
  buildCfnParameters,
  buildCfnStackTags,
  bundleDigestBound,
  captureCfnBootstrapDiagnostic,
  cfnBootstrapDiagnosticArtifactPath,
  runtimeDigestBound,
  cfnSiteAddress,
  cfnStackName,
  createCfnStackAndWait,
  deleteGhcrPackageVersion,
  describeStackEventsTail,
  digestSha256,
  ghcrVersionIdForTag,
  imageDigestBound,
  outputsWellFormed,
  parseCfnBootstrapDiagnosticOutput,
  parseGhcrRepo,
  parseGhcrVersions,
  parseStackOutputs,
  pushCandidateServerImage,
  route53RecordAbsent,
  runScopedImageTag,
  s3KeyPrefix,
  scrubCfnParameterUrls,
  ssmInspectRunningImageDigest,
  templateFileSha256,
  uploadBundleAndPresign,
  validateTemplate,
  writeCfnBootstrapDiagnosticArtifact,
  type CfnBootstrapDiagnosticArtifactV1,
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

const TEST_CFN_TAGS = buildCfnStackTags({
  stackName: "proliferate-sh-cfn-x",
  runId: "run-1",
  shardId: "shard-0",
});

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

test("buildCfnStackTags: emits the bounded IAM/run-ownership tag set and rejects unsafe identity", () => {
  assert.deepEqual(
    buildCfnStackTags({ stackName: "proliferate-sh-cfn-run-1", runId: "run-1", shardId: "shard-0" }),
    [
      { key: "Purpose", value: "self-hosting-qualification" },
      { key: "Name", value: "proliferate-sh-cfn-run-1" },
      { key: "RunId", value: "run-1" },
      { key: "ShardId", value: "shard-0" },
    ],
  );
  assert.throws(
    () => buildCfnStackTags({ stackName: "proliferate-sh-cfn-run-1", runId: "run,other", shardId: "1" }),
    /unsafe RunId ownership tag value/,
  );
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

test("buildCfnParameters: emits all 9 candidate parameters as JSON (file:// form, not argv)", () => {
  const params = buildCfnParameters({
    releaseVersion: "1.2.3",
    serverImageRepository: "ghcr.io/proliferate-ai/proliferate-server-qualification",
    runtimeBinaryUrl: "https://s3/presigned-runtime",
    runtimeBinaryChecksumUrl: "https://s3/presigned-sums",
    deployBundleUrl: "https://s3/presigned-bundle",
    deployBundleChecksumUrl: "https://s3/presigned-sums",
    siteAddress: "sh-x.qualification.proliferate.com",
    hostedZoneId: "Z123",
  });
  const byKey = new Map(params.map((p) => [p.ParameterKey, p.ParameterValue]));
  assert.equal(byKey.get("ReleaseVersion"), "1.2.3");
  assert.equal(byKey.get("CreateRoute53Record"), "true");
  assert.equal(byKey.get("HostedZoneId"), "Z123");
  assert.equal(byKey.get("DeployBundleChecksumUrl"), "https://s3/presigned-sums");
  assert.equal(byKey.get("RuntimeBinaryUrl"), "https://s3/presigned-runtime");
  assert.equal(byKey.get("RuntimeBinaryChecksumUrl"), "https://s3/presigned-sums");
  assert.equal(params.length, 9);
});

test("scrubCfnParameterUrls: redacts presigned S3 URLs from a diagnostic (PR7-CONTROL-003)", () => {
  const dirty =
    "create-stack failed: Parameter DeployBundleUrl=https://bucket.s3.amazonaws.com/x?X-Amz-Signature=deadbeef&X-Amz-Expires=3600 rejected";
  const scrubbed = scrubCfnParameterUrls(dirty);
  assert.ok(!scrubbed.includes("X-Amz-Signature"), "presign signature must be redacted");
  assert.ok(!scrubbed.includes("deadbeef"), "signature value must be redacted");
  assert.ok(scrubbed.includes("[REDACTED_PRESIGNED_URL]"));
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

test("runtimeDigestBound: true iff the sums list the exact arm64 runtime archive", () => {
  const sha = "c".repeat(64);
  assert.equal(runtimeDigestBound(`${sha}  anyharness-aarch64-unknown-linux-musl.tar.gz\n`, sha), true);
  assert.equal(runtimeDigestBound(`${sha}  anyharness-x86_64-unknown-linux-musl.tar.gz\n`, sha), false);
  assert.equal(runtimeDigestBound(`${"d".repeat(64)}  anyharness-aarch64-unknown-linux-musl.tar.gz\n`, sha), false);
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

test("parseCfnBootstrapDiagnosticOutput: emits only allowlisted tokens and drops raw secrets", () => {
  const raw = [
    "__PROLIFERATE_CFN_LOG__:cfn-init-cmd.log",
    "2026-07-19 Running Command 02-bootstrap",
    "2026-07-19 Exited with error code 17: https://bucket/x?X-Amz-Signature=deadbeef",
    "Bearer eyJsecret.payload.signature vk-super-secret-value",
    "download error from https://example.invalid/private?token=secret",
  ].join("\n");
  const observations = parseCfnBootstrapDiagnosticOutput(raw);

  assert.deepEqual(observations[0], {
    source: "cfn-init-cmd.log",
    stage: "02-bootstrap",
    outcome: "failed",
    exit_code: 17,
    category: "download",
  });
  const serialized = JSON.stringify(observations);
  for (const secret of ["X-Amz-Signature", "deadbeef", "Bearer", "eyJsecret", "vk-super", "https://"]) {
    assert.ok(!serialized.includes(secret), `structured evidence leaked ${secret}`);
  }
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

test("uploadBundleAndPresign: registers bundle, runtime, and sums BEFORE each cp and returns presigned URLs", async () => {
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
    runtimePath: "/tmp/anyharness-aarch64-unknown-linux-musl.tar.gz",
    sumsPath: "/tmp/self-hosted-assets.SHA256SUMS",
    registerCleanup: async (kind, providerId) => {
      log.push(`register:${kind}:${providerId}`);
    },
  });
  // Registered-before-create: each s3_object intent precedes its cp.
  const bundleReg = log.indexOf("register:s3_object:s3://bkt/qualification/run-1/shard-0/proliferate-deploy.tar.gz");
  const bundleCp = log.indexOf("cp:s3://bkt/qualification/run-1/shard-0/proliferate-deploy.tar.gz");
  assert.ok(bundleReg >= 0 && bundleReg < bundleCp, `register precedes cp (${JSON.stringify(log)})`);
  const runtimeProvider =
    "s3://bkt/qualification/run-1/shard-0/anyharness-aarch64-unknown-linux-musl.tar.gz";
  assert.ok(
    log.indexOf(`register:s3_object:${runtimeProvider}`) < log.indexOf(`cp:${runtimeProvider}`),
    `runtime register precedes cp (${JSON.stringify(log)})`,
  );
  assert.ok(result.deployBundleUrl.startsWith("https://s3/presigned/"));
  assert.ok(result.runtimeBinaryUrl.startsWith("https://s3/presigned/"));
  assert.ok(result.deployBundleChecksumUrl.startsWith("https://s3/presigned/"));
  assert.equal(result.bundleKey, "qualification/run-1/shard-0/proliferate-deploy.tar.gz");
  assert.equal(
    result.runtimeKey,
    "qualification/run-1/shard-0/anyharness-aarch64-unknown-linux-musl.tar.gz",
  );
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

test("deleteGhcrPackageVersion: REFUSES to delete a version carrying sibling tags (PR7-CONTROL-008)", async () => {
  // The version our run tag points at also carries someone else's tag; deleting
  // the version-id would reap that sibling tag too. Must refuse (a cleanup
  // failure), never blindly delete the shared version.
  const gh = new FakeExec((args) => {
    if (args.includes("--paginate")) {
      return JSON.stringify([{ id: 99, metadata: { container: { tags: ["run-1-shard-0", "stable"] } } }]);
    }
    return "";
  });
  await assert.rejects(
    () => deleteGhcrPackageVersion(gh, "ghcr.io/x/y", "run-1-shard-0"),
    /also carries sibling tag\(s\) \[stable\]; refusing/,
  );
  assert.ok(!gh.calls.some((call) => call.includes("DELETE")), "no DELETE when the version is shared");
});

test("deleteGhcrPackageVersion: deletes when the run tag is the version's SOLE tag", async () => {
  const gh = new FakeExec((args) =>
    args.includes("--paginate") ? JSON.stringify([{ id: 42, metadata: { container: { tags: ["run-1-shard-0"] } } }]) : "",
  );
  await deleteGhcrPackageVersion(gh, "ghcr.io/x/y", "run-1-shard-0");
  assert.ok(gh.calls.some((call) => call.includes("DELETE") && call.join(" ").includes("/versions/42")));
});

test("route53RecordAbsent: true when no A record survives, false on a survivor (PR7-CONTROL-008)", async () => {
  const gone = new FakeExec(() => JSON.stringify({ ResourceRecordSets: [] }));
  assert.equal(await route53RecordAbsent(gone, "Z1", "sh-x.qualification.proliferate.com", "us-east-1"), true);

  const survivor = new FakeExec(() =>
    JSON.stringify({ ResourceRecordSets: [{ Name: "sh-x.qualification.proliferate.com.", Type: "A" }] }),
  );
  assert.equal(await route53RecordAbsent(survivor, "Z1", "sh-x.qualification.proliferate.com", "us-east-1"), false);
});

test("SelfHostCfnCleanupStack: route53RecordDeleted requires the record be OBSERVED absent (PR7-CONTROL-008)", async () => {
  // Stack deletion succeeds, but the observer reports the A record survived →
  // route53RecordDeleted must be false even though stackDeleted is true.
  const stack = new SelfHostCfnCleanupStack({
    ledger: fakeLedger(),
    observeRoute53RecordAbsent: async () => false,
  });
  await stack.registerAcquire("cloudformation_stack", "stk", async () => undefined);
  const summary = await stack.runAll();
  assert.equal(summary.stackDeleted, true);
  assert.equal(summary.route53RecordDeleted, false);
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
  let createArgs: readonly string[] = [];
  const exec = new FakeExec((args) => {
    if (args[1] === "create-stack") {
      log.push("create");
      createArgs = args;
      assert.ok(args.includes("CAPABILITY_IAM"));
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
  let writtenJson = "";
  let removed = false;
  const outputs = await createCfnStackAndWait({
    exec,
    stackName: "proliferate-sh-cfn-x",
    templatePath: "/repo/template.yaml",
    parameters: buildCfnParameters({
      releaseVersion: "1.2.3",
      serverImageRepository: "ghcr.io/x/y",
      runtimeBinaryUrl: "https://s3/r?X-Amz-Signature=SECRET",
      runtimeBinaryChecksumUrl: "https://s3/s?X-Amz-Signature=SECRET",
      deployBundleUrl: "https://s3/b?X-Amz-Signature=SECRET",
      deployBundleChecksumUrl: "https://s3/s?X-Amz-Signature=SECRET",
      siteAddress: site,
      hostedZoneId: "Z1",
    }),
    tags: TEST_CFN_TAGS,
    region: "us-east-1",
    writeParameterFile: async (json) => {
      writtenJson = json;
      return { path: "/tmp/params.json", remove: async () => { removed = true; } };
    },
    registerCleanup: async (kind) => {
      log.push(`register:${kind}`);
    },
  });
  assert.ok(log.indexOf("register:cloudformation_stack") < log.indexOf("create"));
  assert.equal(outputs.instanceId, "i-0abc");
  // PR7-CONTROL-003: params go through a file, NOT argv — and the presigned
  // bearer signature never appears in the create-stack argv.
  assert.ok(createArgs.includes("file:///tmp/params.json"), "parameters must be passed as file://");
  const onFailureAt = createArgs.indexOf("--on-failure");
  assert.ok(onFailureAt >= 0, "qualification create must retain a failed stack for bounded diagnostics");
  assert.equal(createArgs[onFailureAt + 1], "DO_NOTHING");
  const tagsAt = createArgs.indexOf("--tags");
  assert.ok(tagsAt >= 0, "create-stack must carry positive run-ownership tags");
  assert.deepEqual(createArgs.slice(tagsAt + 1, tagsAt + 5), [
    "Key=Purpose,Value=self-hosting-qualification",
    "Key=Name,Value=proliferate-sh-cfn-x",
    "Key=RunId,Value=run-1",
    "Key=ShardId,Value=shard-0",
  ]);
  assert.ok(!createArgs.some((a) => a.includes("X-Amz-Signature")), "no presigned signature in argv");
  assert.ok(!createArgs.some((a) => a.startsWith("ParameterKey=")), "no ParameterKey=... argv pairs");
  assert.ok(writtenJson.includes("DeployBundleUrl"), "the parameter JSON carries the bundle params");
  assert.ok(removed, "the 0600 parameter file is removed after create");
});

test("createCfnStackAndWait: a parameter-file removal failure is NON-GREEN, not swallowed (PR7-CONTROL-003)", async () => {
  // create-stack succeeds, but removing the 0600 file holding live presigned
  // bearer URLs fails — that must fail the cell, not be silently swallowed.
  const site = "sh-x.qualification.proliferate.com";
  const exec = new FakeExec((args) => {
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
  await assert.rejects(
    createCfnStackAndWait({
      exec,
      stackName: "stk",
      templatePath: "/t.yaml",
      parameters: buildCfnParameters({
        releaseVersion: "run-1",
        serverImageRepository: "ghcr.io/x/y",
        runtimeBinaryUrl: "https://s3/r?X-Amz-Signature=SECRET",
        runtimeBinaryChecksumUrl: "https://s3/s?X-Amz-Signature=SECRET",
        deployBundleUrl: "https://s3/b?X-Amz-Signature=SECRET",
        deployBundleChecksumUrl: "https://s3/s?X-Amz-Signature=SECRET",
        siteAddress: site,
        hostedZoneId: "Z1",
      }),
      tags: TEST_CFN_TAGS,
      region: "us-east-1",
      writeParameterFile: async () => ({
        path: "/tmp/leaky-params.json",
        remove: async () => {
          throw new Error("EACCES: permission denied");
        },
      }),
      registerCleanup: async () => undefined,
    }),
    (error: Error) => {
      assert.match(error.message, /failed to remove the 0600 CloudFormation parameter file/);
      assert.match(error.message, /Refusing to continue/);
      // The bearer signature must not leak even in this error.
      assert.ok(!error.message.includes("X-Amz-Signature"));
      return true;
    },
  );
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
      tags: TEST_CFN_TAGS,
      region: "us-east-1",
      writeParameterFile: async () => ({ path: "/tmp/p.json", remove: async () => undefined }),
      registerCleanup: async () => undefined,
    }),
    /ProliferateInstance CREATE_FAILED/,
  );
});

test("create failure: registered retention captures bounded SSM evidence before artifact then delete", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "selfhost-cfn-diagnostic-"));
  const artifactPath = cfnBootstrapDiagnosticArtifactPath(runDir);
  const order: string[] = [];
  let releaseStack: (() => Promise<void>) | undefined;
  const exec = new FakeExec((args) => {
    if (args[0] === "cloudformation" && args[1] === "create-stack") {
      order.push("create");
      return "";
    }
    if (args[0] === "cloudformation" && args[1] === "wait" && args[2] === "stack-create-complete") {
      order.push("wait-create");
      throw new Error("waiter observed CREATE_FAILED");
    }
    if (args[0] === "cloudformation" && args[1] === "describe-stack-events") {
      return JSON.stringify({
        StackEvents: [{
          LogicalResourceId: "ProliferateInstance",
          ResourceStatus: "CREATE_FAILED",
          ResourceStatusReason: "Received FAILURE signal",
        }],
      });
    }
    if (args[0] === "cloudformation" && args[1] === "describe-stack-resource") {
      order.push("describe-instance");
      return "i-0abc\n";
    }
    if (args[0] === "ssm" && args[1] === "describe-instance-information") {
      order.push("ssm-online");
      return "Online\n";
    }
    if (args[0] === "ssm" && args[1] === "send-command") {
      order.push("ssm-send");
      return "command-1\n";
    }
    if (args[0] === "ssm" && args[1] === "get-command-invocation") {
      order.push("ssm-read");
      return JSON.stringify({
        Status: "Success",
        StandardOutputContent: [
          "__PROLIFERATE_CFN_LOG__:cfn-init-cmd.log",
          "Running Command 02-bootstrap",
          "Exited with error code 17: https://s3/x?X-Amz-Signature=secret",
        ].join("\n"),
      });
    }
    if (args[0] === "cloudformation" && args[1] === "delete-stack") {
      order.push("delete");
      return "";
    }
    if (args[0] === "cloudformation" && args[1] === "wait" && args[2] === "stack-delete-complete") {
      order.push("wait-delete");
      return "";
    }
    return "";
  });

  try {
    await assert.rejects(
      createCfnStackAndWait({
        exec,
        stackName: "stk",
        templatePath: "/t.yaml",
        parameters: [],
        tags: TEST_CFN_TAGS,
        region: "us-east-1",
        writeParameterFile: async () => ({ path: "/tmp/p.json", remove: async () => undefined }),
        registerCleanup: async (_kind, _providerId, release) => {
          order.push("register");
          releaseStack = release;
        },
        onCreateFailure: async ({ stackName, region }) => {
          const diagnostic = await captureCfnBootstrapDiagnostic({
            exec,
            stackName,
            region,
            pollTimeoutMs: 100,
            pollIntervalMs: 0,
            now: () => 0,
            sleep: async () => undefined,
          });
          const artifact: CfnBootstrapDiagnosticArtifactV1 = {
            schema_version: 1,
            kind: "proliferate.selfhost-cfn-bootstrap-diagnostic",
            run: { run_id: "run-1", shard_id: "shard-0", attempt: 1, source_sha: "a".repeat(40) },
            diagnostic,
          };
          await writeCfnBootstrapDiagnosticArtifact(artifactPath, artifact);
          order.push("artifact");
          return diagnostic;
        },
      }),
      /Bootstrap diagnostic: captured\(02-bootstrap:failed:exit=17:download\)/,
    );

    assert.ok(releaseStack, "stack cleanup must be registered before create");
    await releaseStack();
    const persisted = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(persisted) as CfnBootstrapDiagnosticArtifactV1;
    assert.equal(parsed.diagnostic.capture_status, "captured");
    assert.equal(parsed.diagnostic.observations[0]?.stage, "02-bootstrap");
    for (const secret of ["X-Amz-Signature", "secret", "https://", "i-0abc", "stk"]) {
      assert.ok(!persisted.includes(secret), `diagnostic artifact leaked ${secret}`);
    }
    assert.ok(order.indexOf("register") < order.indexOf("create"), `registered before create: ${order}`);
    assert.ok(order.indexOf("ssm-read") < order.indexOf("artifact"), `SSM capture before artifact: ${order}`);
    assert.ok(order.indexOf("artifact") < order.indexOf("delete"), `artifact before delete: ${order}`);
    assert.ok(order.indexOf("delete") < order.indexOf("wait-delete"), `delete is awaited: ${order}`);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("create failure: SSM unavailable remains red, persists fixed evidence, and leaves no stack orphan", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "selfhost-cfn-no-ssm-"));
  const artifactPath = cfnBootstrapDiagnosticArtifactPath(runDir);
  const order: string[] = [];
  let releaseStack: (() => Promise<void>) | undefined;
  let clock = 0;
  const exec = new FakeExec((args) => {
    if (args[0] === "cloudformation" && args[1] === "create-stack") {
      order.push("create");
      return "";
    }
    if (args[0] === "cloudformation" && args[1] === "wait" && args[2] === "stack-create-complete") {
      throw new Error("waiter observed CREATE_FAILED");
    }
    if (args[0] === "cloudformation" && args[1] === "describe-stack-events") {
      return JSON.stringify({ StackEvents: [] });
    }
    if (args[0] === "cloudformation" && args[1] === "describe-stack-resource") {
      return "i-0abc\n";
    }
    if (args[0] === "ssm" && args[1] === "describe-instance-information") {
      order.push("ssm-offline");
      return "Offline\n";
    }
    if (args[0] === "cloudformation" && args[1] === "delete-stack") {
      order.push("delete");
      return "";
    }
    if (args[0] === "cloudformation" && args[1] === "wait" && args[2] === "stack-delete-complete") {
      order.push("wait-delete");
      return "";
    }
    return "";
  });

  try {
    await assert.rejects(
      createCfnStackAndWait({
        exec,
        stackName: "stk",
        templatePath: "/t.yaml",
        parameters: [],
        tags: TEST_CFN_TAGS,
        region: "us-east-1",
        writeParameterFile: async () => ({ path: "/tmp/p.json", remove: async () => undefined }),
        registerCleanup: async (_kind, _providerId, release) => {
          order.push("register");
          releaseStack = release;
        },
        onCreateFailure: async ({ stackName, region }) => {
          const diagnostic = await captureCfnBootstrapDiagnostic({
            exec,
            stackName,
            region,
            pollTimeoutMs: 2,
            pollIntervalMs: 1,
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
          });
          await writeCfnBootstrapDiagnosticArtifact(artifactPath, {
            schema_version: 1,
            kind: "proliferate.selfhost-cfn-bootstrap-diagnostic",
            run: { run_id: "run-1", shard_id: "shard-0", attempt: 1, source_sha: "a".repeat(40) },
            diagnostic,
          });
          order.push("artifact");
          return diagnostic;
        },
      }),
      /Bootstrap diagnostic: ssm_unavailable\(ssm_not_online\)/,
    );

    assert.ok(releaseStack, "stack cleanup must still be registered");
    await releaseStack();
    const persisted = JSON.parse(await readFile(artifactPath, "utf8")) as CfnBootstrapDiagnosticArtifactV1;
    assert.equal(persisted.diagnostic.capture_status, "ssm_unavailable");
    assert.equal(persisted.diagnostic.detail, "ssm_not_online");
    assert.equal(exec.calls.some((call) => call[0] === "ssm" && call[1] === "send-command"), false);
    assert.ok(order.indexOf("register") < order.indexOf("create"), `registered before create: ${order}`);
    assert.ok(order.indexOf("artifact") < order.indexOf("delete"), `artifact before cleanup: ${order}`);
    assert.ok(order.includes("wait-delete"), `stack delete must be awaited: ${order}`);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
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
  await stack.registerAcquire("s3_object", "s3://b/runtime", async () => void order.push("s3_runtime"));
  await stack.registerAcquire("s3_object", "s3://b/sums", async () => void order.push("s3_sums"));
  await stack.registerAcquire("ghcr_package_version", "ghcr:tag", async () => void order.push("ghcr"));
  await stack.registerAcquire("cloudformation_stack", "stk", async () => void order.push("stack"));

  const evidence = await stack.runAll();
  assert.deepEqual(order, [
    "stack",
    "ghcr",
    "s3_sums",
    "s3_runtime",
    "s3_bundle",
    "extracted_artifacts",
    "run_directory",
  ]);
  assert.equal(evidence.registered, 7);
  assert.equal(evidence.reconciled, 7);
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
