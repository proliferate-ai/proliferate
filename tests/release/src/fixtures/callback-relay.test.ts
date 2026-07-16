import assert from "node:assert/strict";
import { test } from "node:test";

import {
  callbackRelay,
  CallbackRelayReplayError,
  parseManifest,
  parseReplayedStatus,
  parseReplayFailedStatus,
  type CallbackRelayTransport,
} from "./callback-relay.js";
import type { RelayChannel } from "../worlds/managed-cloud/callback-relay-agent.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

const RUN = { run_id: "run-1", shard_id: "shard-0" } as ManagedCloudWorld["run"];

function fakeWorld(hasBox = true): ManagedCloudWorld {
  return {
    run: RUN,
    box: hasBox ? ({} as BoxExec) : undefined,
  } as unknown as ManagedCloudWorld;
}

interface Call {
  op: string;
  dir: string;
  args: unknown;
}

function fakeTransport(manifest = ""): { transport: CallbackRelayTransport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: CallbackRelayTransport = {
    async writeControl(_box, dir, channel, mode) {
      calls.push({ op: "writeControl", dir, args: { channel, mode } });
    },
    async triggerReplay(_box, dir, target) {
      calls.push({ op: "triggerReplay", dir, args: target });
    },
    async readManifest(_box, dir) {
      calls.push({ op: "readManifest", dir, args: null });
      return manifest;
    },
  };
  return { transport, calls };
}

test("hold(channel) writes the hold control file", async () => {
  const { transport, calls } = fakeTransport();
  const relay = callbackRelay(fakeWorld(), {}, transport);
  await relay.hold("stripe");
  assert.deepEqual(calls, [
    { op: "writeControl", dir: "/home/ubuntu/candidate/callback-relay", args: { channel: "stripe", mode: "hold" } },
  ]);
});

test("release without replayHeld only switches back to pass-through", async () => {
  const { transport, calls } = fakeTransport();
  const relay = callbackRelay(fakeWorld(), {}, transport);
  await relay.release("e2b");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, "writeControl");
  assert.deepEqual(calls[0].args, { channel: "e2b", mode: "pass-through" });
});

test("release with replayHeld replays every held delivery BEFORE re-opening the channel", async () => {
  const { transport, calls } = fakeTransport();
  const relay = callbackRelay(fakeWorld(), {}, transport);
  await relay.release("stripe", { replayHeld: true });
  assert.deepEqual(
    calls.map((c) => c.op),
    ["triggerReplay", "writeControl"],
  );
  assert.deepEqual(calls[0].args, { channel: "stripe" });
  assert.deepEqual(calls[1].args, { channel: "stripe", mode: "pass-through" });
});

test("replay(deliveryId) re-posts one delivery by id", async () => {
  const { transport, calls } = fakeTransport();
  const relay = callbackRelay(fakeWorld(), {}, transport);
  await relay.replay("abcdef01");
  assert.deepEqual(calls, [
    { op: "triggerReplay", dir: "/home/ubuntu/candidate/callback-relay", args: { deliveryId: "abcdef01" } },
  ]);
});

test("replay rejects a non-hex deliveryId (argv safety) before touching the box", async () => {
  const { transport, calls } = fakeTransport();
  const relay = callbackRelay(fakeWorld(), {}, transport);
  await assert.rejects(() => relay.replay("../../etc/passwd"), /non-hex deliveryId/);
  assert.equal(calls.length, 0);
});

test("manifest parses bounded, secret-free rows and filters by channel", async () => {
  const raw = [
    JSON.stringify({
      deliveryId: "d1",
      channel: "stripe",
      providerEventId: "evt_1",
      bytesSha256: "a".repeat(64),
      receivedAt: "2026-07-16T00:00:00Z",
      state: "held",
    }),
    JSON.stringify({
      deliveryId: "d2",
      channel: "e2b",
      providerEventId: null,
      bytesSha256: "b".repeat(64),
      receivedAt: "2026-07-16T00:00:01Z",
      state: "forwarded",
    }),
    "garbage-not-json",
  ].join("\n");
  const { transport } = fakeTransport(raw);
  const relay = callbackRelay(fakeWorld(), {}, transport);

  const all = await relay.manifest();
  assert.equal(all.length, 2);
  const stripeOnly = await relay.manifest("stripe");
  assert.equal(stripeOnly.length, 1);
  assert.equal(stripeOnly[0].deliveryId, "d1");
  assert.equal(stripeOnly[0].providerEventId, "evt_1");
  // No raw body/signature is representable in a CapturedDelivery — only the id,
  // channel, provider event id, bytes hash, timestamp, and state.
  assert.deepEqual(Object.keys(stripeOnly[0]).sort(), [
    "bytesSha256",
    "channel",
    "deliveryId",
    "providerEventId",
    "receivedAt",
    "state",
  ]);
});

test("bytesSha256 witnesses byte-identity: a held row and its replayed row share the same digest", () => {
  const digest = "c".repeat(64);
  const rows = parseManifest(
    [
      JSON.stringify({
        deliveryId: "d9",
        channel: "stripe",
        providerEventId: "evt_9",
        bytesSha256: digest,
        receivedAt: "2026-07-16T00:00:00Z",
        state: "held",
      }),
      JSON.stringify({
        deliveryId: "d9",
        channel: "stripe",
        providerEventId: null,
        bytesSha256: digest,
        receivedAt: "2026-07-16T00:00:05Z",
        state: "replayed:200",
      }),
    ].join("\n"),
  );
  assert.equal(rows[0].bytesSha256, rows[1].bytesSha256);
});

test("the controller exposes NO synthesize/emit method (only delay + replay of genuine deliveries)", () => {
  const relay = callbackRelay(fakeWorld(), {}, fakeTransport().transport);
  assert.deepEqual(Object.keys(relay).sort(), ["hold", "manifest", "release", "replay"]);
  const asRecord = relay as unknown as Record<string, unknown>;
  assert.equal(typeof asRecord.emit, "undefined");
  assert.equal(typeof asRecord.synthesize, "undefined");
});

test("a custom relay dir name flows through to the transport", async () => {
  const { transport, calls } = fakeTransport();
  const relay = callbackRelay(fakeWorld(), { relayDirName: "relay-x" }, transport);
  await relay.hold("stripe");
  assert.equal(calls[0].dir, "/home/ubuntu/candidate/relay-x");
});

test("throws when the world has no box-exec seam", () => {
  assert.throws(() => callbackRelay(fakeWorld(false), {}, fakeTransport().transport), /no box-exec seam/);
});

test("parseManifest ignores rows with an unknown channel or missing required fields", () => {
  const rows = parseManifest(
    [
      JSON.stringify({ deliveryId: "d", channel: "slack", bytesSha256: "x", receivedAt: "t", state: "held" }),
      JSON.stringify({ deliveryId: "d2", channel: "stripe", receivedAt: "t", state: "held" }), // no bytesSha256
    ].join("\n"),
  );
  assert.equal(rows.length, 0);
});

test("parseReplayedStatus / parseReplayFailedStatus extract statuses from their own terminal/retryable rows", () => {
  assert.equal(parseReplayedStatus("replayed:200"), 200);
  assert.equal(parseReplayedStatus("replay_failed:500"), null); // failed is not a terminal replayed row
  assert.equal(parseReplayedStatus("held"), null);
  assert.equal(parseReplayFailedStatus("replay_failed:500"), 500);
  assert.equal(parseReplayFailedStatus("replayed:200"), null);
  assert.equal(parseReplayFailedStatus("held"), null);
});

/** A transport whose replay FAILS (relay exited nonzero) and whose manifest carries the given rows. */
function failingReplayTransport(manifest: string): CallbackRelayTransport {
  return {
    async writeControl() {},
    async triggerReplay() {
      throw new Error("relay.py replay-held exited 1");
    },
    async readManifest() {
      return manifest;
    },
  };
}

test("release({replayHeld}) throws a typed error carrying per-delivery retryable statuses (replay_failed), and does NOT reopen", async () => {
  const manifest = [
    JSON.stringify({
      deliveryId: "d1",
      channel: "stripe",
      providerEventId: null,
      bytesSha256: "a".repeat(64),
      receivedAt: "2026-07-16T00:00:05Z",
      state: "replay_failed:500",
    }),
  ].join("\n");
  let reopened = false;
  const transport: CallbackRelayTransport = {
    ...failingReplayTransport(manifest),
    async writeControl(_box, _dir, _channel, mode) {
      if (mode === "pass-through") reopened = true;
    },
  };
  const relay = callbackRelay(fakeWorld(), {}, transport);
  await assert.rejects(
    () => relay.release("stripe", { replayHeld: true }),
    (error: unknown) => {
      assert.ok(error instanceof CallbackRelayReplayError);
      assert.equal(error.failures.length, 1);
      assert.deepEqual(error.failures[0], { deliveryId: "d1", channel: "stripe", status: 500 });
      return true;
    },
  );
  // The channel must NOT be reopened to pass-through on a lost event.
  assert.equal(reopened, false);
});

test("a delivery that later succeeded (replayed:) is cleared from the retryable-failure set", async () => {
  // Same delivery: a failed attempt then a successful one — no longer a failure.
  const manifest = [
    JSON.stringify({ deliveryId: "d1", channel: "stripe", bytesSha256: "a".repeat(64), receivedAt: "t1", state: "replay_failed:500" }),
    JSON.stringify({ deliveryId: "d1", channel: "stripe", bytesSha256: "a".repeat(64), receivedAt: "t2", state: "replayed:200" }),
  ].join("\n");
  const transport = failingReplayTransport(manifest);
  const relay = callbackRelay(fakeWorld(), {}, transport);
  await assert.rejects(
    () => relay.replay("abcdef01"),
    (error: unknown) => {
      assert.ok(error instanceof CallbackRelayReplayError);
      // The transport still threw (relay exited nonzero for THIS invocation), but
      // no delivery is in a retryable-failure state, so failures is empty.
      assert.equal(error.failures.length, 0);
      return true;
    },
  );
});

test("replay(deliveryId) throws CallbackRelayReplayError when the relay reports a non-2xx (retryable) replay", async () => {
  const manifest = JSON.stringify({
    deliveryId: "abcdef01",
    channel: "e2b",
    providerEventId: null,
    bytesSha256: "b".repeat(64),
    receivedAt: "2026-07-16T00:00:05Z",
    state: "replay_failed:502",
  });
  const relay = callbackRelay(fakeWorld(), {}, failingReplayTransport(manifest));
  await assert.rejects(
    () => relay.replay("abcdef01"),
    (error: unknown) => error instanceof CallbackRelayReplayError && error.failures[0]?.status === 502,
  );
});
