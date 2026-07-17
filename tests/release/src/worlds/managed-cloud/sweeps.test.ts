import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countArrayField,
  countMatchingRecordSets,
  countNonTerminalInstances,
  sweepAwsForRun,
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
