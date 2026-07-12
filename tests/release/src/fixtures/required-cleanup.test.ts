import assert from "node:assert/strict";
import { test } from "node:test";

import { withRequiredCleanup } from "./required-cleanup.js";

test("an injected EC2 cleanup failure is red and identifies every leaked resource", async () => {
  await assert.rejects(
    withRequiredCleanup({
      label: "self-host qualification box",
      resourceIds: ["instance=i-sentinel", "security-group=sg-sentinel", "key-pair=key-sentinel"],
      run: async () => "green body",
      cleanup: async () => {
        throw new Error("terminate-instances failed");
      },
    }),
    /instance=i-sentinel, security-group=sg-sentinel, key-pair=key-sentinel.*terminate-instances failed/,
  );
});

test("an ECS restore failure aggregates with the scenario failure instead of masking it", async () => {
  const scenarioError = new Error("runtime convergence failed");
  await assert.rejects(
    withRequiredCleanup({
      label: "staging ECS runtime pin",
      resourceIds: ["cluster=staging", "service=server", "task-definition=arn:previous"],
      run: async () => {
        throw scenarioError;
      },
      cleanup: async () => {
        throw new Error("update-service restore failed");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /task-definition=arn:previous/);
      assert.equal(error.errors[0], scenarioError);
      assert.match(String(error.errors[1]), /update-service restore failed/);
      return true;
    },
  );
});

test("successful required cleanup preserves the original scenario error", async () => {
  const scenarioError = new Error("product assertion failed");
  await assert.rejects(
    withRequiredCleanup({
      label: "fixture",
      resourceIds: ["id=one"],
      run: async () => {
        throw scenarioError;
      },
      cleanup: async () => undefined,
    }),
    (error: unknown) => error === scenarioError,
  );
});
