import assert from "node:assert/strict";
import {
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { toFailureReport } from "../report/failure-reporter.js";
import { withRequiredCleanup } from "./required-cleanup.js";
import {
  SECRET_SENTINEL,
  assertOperation,
  cleanupFailurePattern,
  cleanupOperations,
  createMockHarness,
  operationCount,
  readCalls,
  resourceExists,
  runShell,
  terminateArgs,
  withTemporaryEnvironment,
} from "./selfhost-box-mock.js";
import {
  provisionSelfHostBox,
  terminateSelfHostBox,
  type SelfHostBox,
} from "./selfhost.js";

test("provision cleanup owns partial key, security-group, and instance resources", () => {
  const cases = [
    {
      name: "lost key-pair creation response",
      failOps: "ec2:create-key-pair",
      expectedCleanup: ["ec2:delete-key-pair"],
    },
    {
      name: "failure immediately after key-pair creation",
      failOps: "ec2:create-security-group",
      expectedCleanup: ["ec2:delete-security-group", "ec2:delete-key-pair"],
    },
    {
      name: "failure immediately after security-group creation",
      failOps: "ec2:authorize-security-group-ingress",
      expectedCleanup: ["ec2:delete-security-group", "ec2:delete-key-pair"],
    },
    {
      name: "failure immediately after instance creation",
      failOps: "ec2:wait:instance-running",
      expectedCleanup: [
        "ec2:terminate-instances",
        "ec2:wait:instance-terminated",
        "ec2:delete-security-group",
        "ec2:delete-key-pair",
      ],
    },
  ];

  for (const fixtureCase of cases) {
    const harness = createMockHarness(fixtureCase.failOps);
    try {
      const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
      assert.notEqual(result.status, 0, fixtureCase.name);
      assert.match(result.stderr, /provision failed; cleaning partial resources/);
      assert.match(result.stderr, /partial resource cleanup complete after provision failure/);
      assert.equal(result.stderr.includes("teardown complete"), false);
      assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
      for (const operation of fixtureCase.expectedCleanup) {
        assertOperation(result.calls, operation, fixtureCase.name);
      }
      assert.deepEqual(
        readdirSync(harness.directory).filter((name) => name.endsWith(".pem")),
        [],
        `${fixtureCase.name}: private key file survived cleanup`,
      );
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  }
});

test("successful provision transfers ownership only after emitting its JSON handoff", () => {
  const harness = createMockHarness("");
  try {
    const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
    assert.equal(result.status, 0);
    const box = JSON.parse(result.stdout) as SelfHostBox;
    assert.equal(box.instanceId, "i-selfhost-test");
    assert.equal(box.sgId, "sg-selfhost-test");
    assert.equal(box.publicIp, "203.0.113.10");
    assert.equal(existsSync(box.keyPath), true);
    for (const operation of cleanupOperations) {
      assert.equal(operationCount(result.calls, operation), 0, `success unexpectedly ran ${operation}`);
    }
    assert.equal(result.stderr.includes("provision failed"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("partial-provision cleanup failure remains red and never claims completion", () => {
  const harness = createMockHarness(
    "ec2:create-security-group,ec2:delete-security-group,ec2:delete-key-pair",
  );
  try {
    const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
    assert.notEqual(result.status, 0);
    assertOperation(result.calls, "ec2:delete-security-group", "partial cleanup");
    assertOperation(result.calls, "ec2:delete-key-pair", "partial cleanup");
    assert.match(result.stderr, /partial resource cleanup failed after provision failure/);
    assert.match(result.stderr, /provision remains failed with partial-resource cleanup risk/);
    assert.equal(result.stderr.includes("partial resource cleanup complete"), false);
    assert.equal(result.stderr.includes("teardown complete"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("lost run-instances response polls None until the client token resolves to an instance", () => {
  const harness = createMockHarness({
    statefulResources: true,
    successLostOps: "ec2:run-instances",
    describeClientTokenSequence: "None,i-selfhost-test",
    instanceRecoveryAttempts: 3,
  });
  try {
    const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
    assert.notEqual(result.status, 0, "the lost provider response remains a failed provision");
    assert.equal(operationCount(result.calls, "ec2:describe-instances"), 2);
    assertOperation(result.calls, "ec2:terminate-instances", "resolved partial instance");
    assert.match(result.stderr, /partial resource cleanup complete after provision failure/);
    assert.equal(resourceExists(harness, "instance"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("persistent None is unknown, stays red, and retains client-token recovery context", () => {
  const harness = createMockHarness({
    statefulResources: true,
    successLostOps: "ec2:run-instances",
    describeClientTokenSequence: "None",
    instanceRecoveryAttempts: 3,
  });
  try {
    const result = runShell(harness, ["provision", "--tag", "0.3.99"]);
    assert.notEqual(result.status, 0);
    assert.equal(operationCount(result.calls, "ec2:describe-instances"), 3);
    assert.match(
      result.stderr,
      /resolve-instance\(client-token=selfhost-e2e-[^,]+, exhausted=3, last=None\)/,
    );
    assert.match(result.stderr, /partial resource cleanup failed after provision failure/);
    assert.equal(result.stderr.includes("partial resource cleanup complete"), false);
    assert.equal(result.stderr.includes("teardown complete"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
    assert.equal(resourceExists(harness, "instance"), true, "unknown instance was falsely cleared");
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("terminate attempts every resource and makes each AWS cleanup failure red", () => {
  for (const failOp of [
    "ec2:terminate-instances",
    "ec2:wait:instance-terminated",
    "ec2:delete-security-group",
    "ec2:delete-key-pair",
  ]) {
    const harness = createMockHarness(failOp);
    const keyPath = path.join(harness.directory, "owned-private-key.pem");
    writeFileSync(keyPath, `private material ${SECRET_SENTINEL}\n`, { mode: 0o600 });
    try {
      const result = runShell(harness, terminateArgs(keyPath));
      assert.notEqual(result.status, 0, failOp);
      for (const operation of cleanupOperations) {
        assertOperation(result.calls, operation, `${failOp}: all cleanup resources are attempted`);
      }
      assert.match(result.stderr, cleanupFailurePattern(failOp));
      assert.match(
        result.stderr,
        /teardown failed for instance=i-selfhost-test security-group=sg-selfhost-test key-pair=key-selfhost-test/,
      );
      assert.equal(result.stderr.includes("teardown complete"), false);
      assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
      assert.equal(existsSync(keyPath), false, `${failOp}: local private key survived cleanup`);
      if (failOp === "ec2:delete-security-group") {
        assert.equal(operationCount(result.calls, failOp), 3);
        assert.match(result.stderr, /delete-security-group\(security-group=sg-selfhost-test, exhausted=3\)/);
      }
    } finally {
      rmSync(harness.directory, { recursive: true, force: true });
    }
  }
});

test("terminate aggregates simultaneous failures without a false success", () => {
  const harness = createMockHarness(cleanupOperations.join(","));
  const keyPath = path.join(harness.directory, "owned-private-key.pem");
  writeFileSync(keyPath, "private material\n", { mode: 0o600 });
  try {
    const result = runShell(harness, terminateArgs(keyPath));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /terminate-instances\(instance=i-selfhost-test\)/);
    assert.match(result.stderr, /wait-instance-terminated\(instance=i-selfhost-test\)/);
    assert.match(result.stderr, /delete-security-group\(security-group=sg-selfhost-test, exhausted=3\)/);
    assert.match(result.stderr, /delete-key-pair\(key-pair=key-selfhost-test\)/);
    assert.equal(result.stderr.includes("teardown complete"), false);
    assert.equal(result.stderr.includes(SECRET_SENTINEL), false);
    assert.equal(existsSync(keyPath), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("terminate reports completion only after every cleanup operation succeeds", () => {
  const harness = createMockHarness("");
  const keyPath = path.join(harness.directory, "owned-private-key.pem");
  writeFileSync(keyPath, "private material\n", { mode: 0o600 });
  try {
    const result = runShell(harness, terminateArgs(keyPath));
    assert.equal(result.status, 0);
    for (const operation of cleanupOperations) {
      assertOperation(result.calls, operation, "successful teardown");
    }
    assert.match(
      result.stderr,
      /teardown complete for instance=i-selfhost-test security-group=sg-selfhost-test key-pair=key-selfhost-test/,
    );
    assert.equal(result.stderr.includes("teardown failed"), false);
    assert.equal(existsSync(keyPath), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("cleanup rerun after provider-side success with a lost response is idempotently clean", () => {
  const harness = createMockHarness({
    statefulResources: true,
    initialResources: true,
    successLostOps: [
      "ec2:terminate-instances",
      "ec2:delete-security-group",
      "ec2:delete-key-pair",
    ].join(","),
  });
  const keyPath = path.join(harness.directory, "owned-private-key.pem");
  writeFileSync(keyPath, "private material\n", { mode: 0o600 });
  try {
    const first = runShell(harness, terminateArgs(keyPath));
    assert.notEqual(first.status, 0, "lost cleanup responses cannot be green");
    assert.equal(first.stderr.includes("teardown complete"), false);

    const rerun = runShell(harness, terminateArgs(keyPath));
    assert.equal(rerun.status, 0, "confirmed NotFound resources are idempotently clean");
    assert.match(rerun.stderr, /teardown complete for instance=i-selfhost-test/);
    assert.equal(rerun.stderr.includes("cleanup failure"), false);
    assert.equal(rerun.stderr.includes(SECRET_SENTINEL), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("confirmed already-absent resources are a clean teardown", () => {
  const harness = createMockHarness({ statefulResources: true });
  const keyPath = path.join(harness.directory, "already-absent.pem");
  try {
    const result = runShell(harness, terminateArgs(keyPath));
    assert.equal(result.status, 0);
    assert.match(result.stderr, /teardown complete for instance=i-selfhost-test/);
    assert.equal(result.stderr.includes("cleanup failure"), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("provision timeout TERM-waits for partial-resource traps before considering SIGKILL", async () => {
  const harness = createMockHarness({
    statefulResources: true,
    hangOp: "ec2:wait:instance-running",
    provisionTimeoutMs: 1_500,
    terminationGraceMs: 3_000,
  });
  try {
    const error = await withTemporaryEnvironment(harness.env, async () => {
      try {
        await provisionSelfHostBox("0.3.99");
      } catch (caught) {
        return caught;
      }
      throw new Error("timed provision unexpectedly passed");
    });
    assert.ok(error instanceof Error);
    const message = String(error);
    assert.match(message, /timed out after 1\.5s/);
    assert.match(message, /process exited during the 3s SIGTERM cleanup grace/);
    assert.match(message, /partial resource cleanup complete after provision failure/);
    assert.equal(message.includes("SIGKILL was required"), false);
    assert.equal(message.includes(SECRET_SENTINEL), false);
    const calls = readCalls(harness);
    for (const operation of cleanupOperations) {
      assertOperation(calls, operation, "timeout cleanup");
    }
    assert.equal(resourceExists(harness, "instance"), false);
    assert.deepEqual(
      readdirSync(harness.directory).filter((name) => name.endsWith(".pem")),
      [],
    );
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("timeout escalates to process-group KILL only when cleanup exceeds its grace", async () => {
  const harness = createMockHarness({
    statefulResources: true,
    hangOp: "ec2:wait:instance-running,ec2:terminate-instances",
    provisionTimeoutMs: 1_500,
    terminationGraceMs: 300,
  });
  try {
    const error = await withTemporaryEnvironment(harness.env, async () => {
      try {
        await provisionSelfHostBox("0.3.99");
      } catch (caught) {
        return caught;
      }
      throw new Error("stubborn timed provision unexpectedly passed");
    });
    assert.ok(error instanceof Error);
    const message = String(error);
    assert.match(message, /SIGTERM cleanup grace \(0\.3s\) expired and SIGKILL was required/);
    assert.equal(message.includes("partial resource cleanup complete"), false);
    assertOperation(readCalls(harness), "ec2:terminate-instances", "stubborn cleanup");
    assert.equal(resourceExists(harness, "instance"), true, "KILL path falsely cleared the instance");
    assert.equal(message.includes(SECRET_SENTINEL), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

test("TypeScript cleanup wrappers preserve red evidence IDs without secret leakage", async () => {
  const harness = createMockHarness("ec2:terminate-instances");
  const keyPath = path.join(harness.directory, "owned-private-key.pem");
  writeFileSync(keyPath, `private material ${SECRET_SENTINEL}\n`, { mode: 0o600 });
  const box: SelfHostBox = {
    instanceId: "i-selfhost-test",
    sgId: "sg-selfhost-test",
    keyName: "key-selfhost-test",
    keyPath,
    publicIp: "203.0.113.10",
    url: "https://203.0.113.10.sslip.io",
    sshUser: "ubuntu",
  };

  try {
    const error = await withTemporaryEnvironment(harness.env, async () => {
      try {
        await withRequiredCleanup({
          label: "self-host qualification box",
          resourceIds: [
            `instance=${box.instanceId}`,
            `security-group=${box.sgId}`,
            `key-pair=${box.keyName}`,
          ],
          run: async () => "green body",
          cleanup: () => terminateSelfHostBox(box),
        });
      } catch (caught) {
        return caught;
      }
      throw new Error("cleanup unexpectedly passed");
    });

    assert.ok(error instanceof Error);
    assert.equal(String(error).includes(SECRET_SENTINEL), false);
    const evidence = toFailureReport({
      scenarioId: "T3-SH-MOCK",
      registryFlowRef: "specs/developing/testing/self-hosting.md",
      lane: "local",
      expected: "external resources are removed",
      error,
    });
    const evidenceBytes = JSON.stringify(evidence);
    assert.match(evidenceBytes, /instance=i-selfhost-test/);
    assert.match(evidenceBytes, /security-group=sg-selfhost-test/);
    assert.match(evidenceBytes, /key-pair=key-selfhost-test/);
    assert.match(evidenceBytes, /Required cleanup failed/);
    assert.match(evidenceBytes, /terminate-instances\(instance=i-selfhost-test\)/);
    assert.equal(evidenceBytes.includes(SECRET_SENTINEL), false);
    assert.equal(existsSync(keyPath), false);
  } finally {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});
