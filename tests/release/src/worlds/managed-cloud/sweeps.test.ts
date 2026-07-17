import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  countArrayField,
  countMatchingRecordSets,
  countNonTerminalInstances,
  sweepAwsForRun,
  sweepE2bForTemplate,
  sweepFilesystemPaths,
  sweepProcessHostFromAws,
  type SweepExec,
} from "./sweeps.js";

test("countNonTerminalInstances ignores terminated / shutting-down instances", () => {
  const stdout = JSON.stringify({
    Reservations: [
      { Instances: [{ State: { Name: "terminated" } }, { State: { Name: "running" } }] },
      { Instances: [{ State: { Name: "shutting-down" } }] },
    ],
  });
  assert.equal(countNonTerminalInstances(stdout), 1);
});

test("countNonTerminalInstances counts an unknown/absent state as still-owned (fail-closed)", () => {
  const stdout = JSON.stringify({ Reservations: [{ Instances: [{}] }] });
  assert.equal(countNonTerminalInstances(stdout), 1);
});

test("countArrayField counts SecurityGroups / KeyPairs entries; empty is zero", () => {
  assert.equal(countArrayField(JSON.stringify({ SecurityGroups: [] }), "SecurityGroups"), 0);
  assert.equal(countArrayField(JSON.stringify({ KeyPairs: [{ KeyName: "mcq-1" }] }), "KeyPairs"), 1);
});

test("countMatchingRecordSets matches the run record name ignoring the trailing dot", () => {
  const stdout = JSON.stringify({
    ResourceRecordSets: [
      { Name: "run.qualification.proliferate.com." },
      { Name: "other.qualification.proliferate.com." },
    ],
  });
  assert.equal(countMatchingRecordSets(stdout, "run.qualification.proliferate.com"), 1);
  assert.equal(countMatchingRecordSets(stdout, "absent.qualification.proliferate.com"), 0);
});

test("sweepAwsForRun reports zero remaining when every category is clean", async () => {
  const exec: SweepExec = async (_file, args) => {
    if (args.includes("describe-instances")) {
      return { stdout: JSON.stringify({ Reservations: [{ Instances: [{ State: { Name: "terminated" } }] }] }), stderr: "" };
    }
    if (args.includes("describe-security-groups")) {
      return { stdout: JSON.stringify({ SecurityGroups: [] }), stderr: "" };
    }
    if (args.includes("describe-key-pairs")) {
      return { stdout: JSON.stringify({ KeyPairs: [] }), stderr: "" };
    }
    if (args.includes("list-resource-record-sets")) {
      return { stdout: JSON.stringify({ ResourceRecordSets: [] }), stderr: "" };
    }
    return { stdout: "{}", stderr: "" };
  };
  const result = await sweepAwsForRun(
    { region: "us-east-1", hostedZoneId: "Z1", recordName: "run.q.example", runId: "r", shardId: "s", keyNamePrefix: "mcq-r-s" },
    exec,
  );
  assert.equal(result.remaining, 0);
  assert.deepEqual(result.errors, []);
});

test("sweepAwsForRun counts a surviving instance + SG + key pair + DNS record", async () => {
  const exec: SweepExec = async (_file, args) => {
    if (args.includes("describe-instances")) {
      return { stdout: JSON.stringify({ Reservations: [{ Instances: [{ State: { Name: "running" } }] }] }), stderr: "" };
    }
    if (args.includes("describe-security-groups")) {
      return { stdout: JSON.stringify({ SecurityGroups: [{ GroupId: "sg-1" }] }), stderr: "" };
    }
    if (args.includes("describe-key-pairs")) {
      return { stdout: JSON.stringify({ KeyPairs: [{ KeyName: "mcq-r-s-1" }] }), stderr: "" };
    }
    if (args.includes("list-resource-record-sets")) {
      return { stdout: JSON.stringify({ ResourceRecordSets: [{ Name: "run.q.example." }] }), stderr: "" };
    }
    return { stdout: "{}", stderr: "" };
  };
  const result = await sweepAwsForRun(
    { region: "us-east-1", hostedZoneId: "Z1", recordName: "run.q.example", runId: "r", shardId: "s", keyNamePrefix: "mcq-r-s" },
    exec,
  );
  assert.equal(result.remaining, 4);
  assert.deepEqual(result.detail, { instances: 1, securityGroups: 1, keyPairs: 1, dnsRecords: 1 });
});

test("sweepAwsForRun treats a CLI failure as ambiguous → fail-closed (counts remaining)", async () => {
  const exec: SweepExec = async (_file, args) => {
    if (args.includes("describe-instances")) {
      throw new Error("aws: could not connect");
    }
    if (args.includes("describe-security-groups")) return { stdout: JSON.stringify({ SecurityGroups: [] }), stderr: "" };
    if (args.includes("describe-key-pairs")) return { stdout: JSON.stringify({ KeyPairs: [] }), stderr: "" };
    return { stdout: JSON.stringify({ ResourceRecordSets: [] }), stderr: "" };
  };
  const result = await sweepAwsForRun(
    { region: "us-east-1", hostedZoneId: "Z1", recordName: "run.q.example", runId: "r", shardId: "s", keyNamePrefix: "mcq-r-s" },
    exec,
  );
  assert.ok(result.remaining >= 1);
  assert.ok(result.errors.some((e) => e.includes("describe-instances")));
});

test("sweepE2bForTemplate counts live sandboxes plus the still-present exact template", async () => {
  const result = await sweepE2bForTemplate(
    "tmpl-1",
    async () => ({
      matches: [{ providerSandboxId: "sbx-1", state: "paused", templateId: "tmpl-1" }],
      count: 1,
    }),
    async () => ["tmpl-other", "tmpl-1"],
  );
  assert.equal(result.remaining, 2);
});

test("sweepE2bForTemplate rejects malformed counts and mismatched attribution", async () => {
  await assert.rejects(
    () => sweepE2bForTemplate(
      "tmpl-1",
      async () => ({ matches: [], count: 1 }),
      async () => [],
    ),
    /count does not match/,
  );
  await assert.rejects(
    () => sweepE2bForTemplate(
      "tmpl-1",
      async () => ({
        matches: [{ providerSandboxId: "sbx-1", state: "running", templateId: "tmpl-other" }],
        count: 1,
      }),
      async () => [],
    ),
    /ambiguously attributed/,
  );
});

test("sweepFilesystemPaths counts a present owned path and treats only ENOENT as absent", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mc-sweep-fs-"));
  const present = path.join(dir, "present");
  const absent = path.join(dir, "absent");
  try {
    await writeFile(present, "x");
    assert.deepEqual(await sweepFilesystemPaths([present, absent]), { remaining: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sweepProcessHostFromAws derives relay-process absence only from a conclusive host sweep", () => {
  assert.deepEqual(
    sweepProcessHostFromAws({
      remaining: 0,
      detail: { instances: 0, securityGroups: 0, keyPairs: 0, dnsRecords: 0 },
      errors: [],
    }),
    { remaining: 0 },
  );
  assert.deepEqual(
    sweepProcessHostFromAws({
      remaining: 1,
      detail: { instances: 1, securityGroups: 0, keyPairs: 0, dnsRecords: 0 },
      errors: [],
    }),
    { remaining: 1 },
  );
  assert.throws(
    () => sweepProcessHostFromAws({
      remaining: 1,
      detail: { instances: 1, securityGroups: 0, keyPairs: 0, dnsRecords: 0 },
      errors: ["describe-instances failed"],
    }),
    /ambiguous/,
  );
});

test("strict AWS response parsers reject missing collection fields", () => {
  assert.throws(() => countNonTerminalInstances("{}"), /Reservations/);
  assert.throws(() => countArrayField("{}", "SecurityGroups"), /SecurityGroups/);
  assert.throws(() => countMatchingRecordSets("{}", "run.q.example"), /ResourceRecordSets/);
});
