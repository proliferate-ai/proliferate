import assert from "node:assert/strict";
import { test } from "node:test";

import type { CleanupResourceKind } from "../local-workspace/cleanup-ledger.js";
import {
  QUALIFICATION_ZONE,
  deleteRoute53ARecord,
  runSubdomainLabel,
  upsertRoute53ARecord,
  type Route53Exec,
} from "./dns.js";

function fakeRoute53Exec(calls: string[][]): Route53Exec {
  return {
    async run(args) {
      calls.push([...args]);
      return "";
    },
  };
}

test("upsertRoute53ARecord registers the DELETE releaser BEFORE the UPSERT and returns the FQDN", async () => {
  const calls: string[][] = [];
  const order: string[] = [];
  let registeredBeforeChange = false;
  const registerCleanup = async (
    kind: Extract<CleanupResourceKind, "route53_record">,
    providerId: string,
    _release: () => Promise<void>,
  ): Promise<void> => {
    order.push(`register:${kind}:${providerId}`);
    registeredBeforeChange = calls.length === 0; // no change submitted yet
  };

  const record = await upsertRoute53ARecord({
    hostedZoneId: "Z123",
    subdomain: "sh-run-1-shard-0-deadbeef",
    ip: "203.0.113.50",
    exec: fakeRoute53Exec(calls),
    registerCleanup,
  });

  assert.equal(registeredBeforeChange, true);
  assert.equal(record.recordName, `sh-run-1-shard-0-deadbeef.${QUALIFICATION_ZONE}`);
  assert.equal(record.ip, "203.0.113.50");
  assert.equal(record.ttl, 60);

  const change = calls.find((c) => c.join(" ").includes("change-resource-record-sets"))!;
  const batch = JSON.parse(change[change.indexOf("--change-batch") + 1]) as {
    Changes: Array<{ Action: string; ResourceRecordSet: { Name: string; Type: string; ResourceRecords: Array<{ Value: string }> } }>;
  };
  assert.equal(batch.Changes[0].Action, "UPSERT");
  assert.equal(batch.Changes[0].ResourceRecordSet.Type, "A");
  assert.equal(batch.Changes[0].ResourceRecordSet.ResourceRecords[0].Value, "203.0.113.50");
});

test("deleteRoute53ARecord issues a DELETE and is idempotent when the record is already gone", async () => {
  const calls: string[][] = [];
  await deleteRoute53ARecord(
    { hostedZoneId: "Z123", recordName: `x.${QUALIFICATION_ZONE}`, ip: "203.0.113.50", ttl: 60 },
    { exec: fakeRoute53Exec(calls) },
  );
  const batch = JSON.parse(calls[0][calls[0].indexOf("--change-batch") + 1]) as { Changes: Array<{ Action: string }> };
  assert.equal(batch.Changes[0].Action, "DELETE");

  const missing: Route53Exec = {
    async run() {
      throw new Error("InvalidChangeBatch: Tried to delete resource record set but it was not found");
    },
  };
  await assert.doesNotReject(
    deleteRoute53ARecord(
      { hostedZoneId: "Z123", recordName: `x.${QUALIFICATION_ZONE}`, ip: "203.0.113.50", ttl: 60 },
      { exec: missing },
    ),
  );
});

test("runSubdomainLabel is a valid, deterministic, collision-free DNS label", async () => {
  const label = runSubdomainLabel("local-20260714-abc", "shard-0");
  assert.match(label, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  assert.ok(label.length <= 63);
  // Deterministic.
  assert.equal(label, runSubdomainLabel("local-20260714-abc", "shard-0"));
  // Different run OR shard yields a different label (digest disambiguates).
  assert.notEqual(label, runSubdomainLabel("local-20260714-abc", "shard-1"));
  assert.notEqual(label, runSubdomainLabel("local-20260714-abd", "shard-0"));
  // A very long / dirty run id is still clamped to a valid label.
  const dirty = runSubdomainLabel("LOCAL_" + "X".repeat(200), "Shard/Weird");
  assert.match(dirty, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  assert.ok(dirty.length <= 63);
});
