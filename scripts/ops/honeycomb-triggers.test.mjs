// Proofs for the Honeycomb SLI trigger operator (honeycomb-triggers.mjs).
// Offline only: intent hygiene, the API-body mapping, live comparison, the
// synthetic-breach payload's boundedness, and console redaction. The live
// verbs are proven by the receipts the monitor lane records.

import assert from "node:assert/strict";
import test from "node:test";

import { redact } from "./grafana-alerting.mjs";
import {
  apiBody,
  compareLive,
  EXPECTED_SLUGS,
  intentChecksum,
  loadIntents,
  syntheticBreachPayload,
  validateIntent,
} from "./honeycomb-triggers.mjs";

test("the checked-in intent set is exactly the five SLIs and every file validates", () => {
  const intents = loadIntents();
  assert.deepEqual(
    intents.map(({ intent }) => intent.slug).sort(),
    [...EXPECTED_SLUGS],
  );
  for (const entry of intents) {
    assert.deepEqual(validateIntent(entry), [], entry.file);
  }
});

test("a checksum mismatch is rejected, so a hand-edit cannot land unstamped", () => {
  const [{ file, intent }] = loadIntents();
  const tampered = { ...intent, frequency: intent.frequency + 60 };
  const errors = validateIntent({ file, intent: tampered });
  assert.ok(errors.some((error) => error.includes("checksum mismatch")), errors.join("; "));
});

test("only exported attribute names may appear in a query", () => {
  const [{ file, intent }] = loadIntents();
  const smuggled = {
    ...intent,
    query: {
      ...intent.query,
      filters: [{ column: "user.email", op: "=", value: "x" }],
    },
  };
  smuggled.checksum = intentChecksum(smuggled);
  const errors = validateIntent({ file, intent: smuggled });
  assert.ok(errors.some((error) => error.includes("not an exported attribute")), errors.join("; "));
});

test("the api body maps a pending recipient to an empty recipients list", () => {
  const [{ intent }] = loadIntents();
  const body = apiBody(intent);
  assert.deepEqual(body.recipients, []);
  assert.equal(body.frequency, intent.frequency);
  assert.deepEqual(body.threshold, intent.threshold);
  const withRecipient = apiBody({ ...intent, recipient: { type: "slack", id: "r-123" } });
  assert.deepEqual(withRecipient.recipients, [{ id: "r-123" }]);
});

test("compareLive flags drift field by field and reports the pending recipient", () => {
  const [{ intent }] = loadIntents();
  const live = { ...apiBody(intent), recipients: [] };
  const clean = compareLive(intent, live);
  assert.deepEqual(
    clean.filter((m) => !m.startsWith("recipient pending")),
    [],
  );
  const drifted = { ...live, frequency: intent.frequency * 2, threshold: { op: ">", value: 999 } };
  const mismatches = compareLive(intent, drifted);
  assert.ok(mismatches.includes("frequency differs"));
  assert.ok(mismatches.includes("threshold differs"));
});

test("filter comparison is order-insensitive, so provider reordering is not drift", () => {
  const [{ intent }] = loadIntents();
  const live = apiBody(intent);
  live.query = { ...live.query, filters: [...live.query.filters].reverse() };
  const mismatches = compareLive(intent, live).filter((m) => !m.startsWith("recipient pending"));
  assert.deepEqual(mismatches, []);
});

test("the synthetic breach is bounded, marked, dogfood-addressed, and closed-vocabulary", () => {
  const payload = syntheticBreachPayload(8, 1_700_000_000_000_000_000n);
  const resource = payload.resourceLogs[0].resource.attributes;
  const environment = resource.find((a) => a.key === "deployment.environment.name");
  assert.equal(environment.value.stringValue, "dogfood");
  const records = payload.resourceLogs[0].scopeLogs[0].logRecords;
  assert.equal(records.length, 8);
  for (const record of records) {
    const byKey = Object.fromEntries(record.attributes.map((a) => [a.key, a.value.stringValue]));
    assert.equal(byKey["proliferate.record_class"], "lifecycle");
    assert.equal(byKey["proliferate.privacy"], "operational");
    assert.equal(byKey["proliferate.argument.origin"], "synthetic_breach_o2");
    assert.ok(
      Object.keys(byKey).every((key) => key.startsWith("proliferate.")),
      "only exported attribute names",
    );
  }
});

test("redaction strips long tokens and urls from anything the tool prints", () => {
  const leaked = `apply failed: https://api.honeycomb.io/1/triggers/anyharness key hcaik_0123456789abcdef0123456789abcdef`;
  const clean = redact(leaked);
  assert.ok(!clean.includes("hcaik_0123456789abcdef"));
  assert.ok(!clean.includes("api.honeycomb.io"));
});
