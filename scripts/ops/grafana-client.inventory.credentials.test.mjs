import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

import {
  TARGET,
  assertOperatorAccount,
  createGrafanaClient,
  resolveSecretField,
} from "./grafana-client.mjs";
import { runContextualAwsCommand } from "./grafana-credential-process.mjs";
import { readMetadataInventoryInternal } from "./grafana-metadata-inventory.mjs";
import {
  INVENTORY_TARGET,
  controlledRuntime,
  deferred,
  emptyPlan,
  publicFixture,
  surfaceFailure,
} from "./grafana-client.inventory.fixtures.mjs";

// Concrete resolveSecretField instance used to exercise the contextual
// credential-resolution machinery (signal + deadline guard + account gate).
const resolveViewerToken = (options = {}) =>
  resolveSecretField("ops/inventory", "grafanaToken", options);

function assertAllCredentialUnavailable(result) {
  for (const surface of Object.values(result.surfaces)) {
    assert.deepEqual(surface, surfaceFailure("unavailable", "credential_unavailable"));
  }
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function validAwsImpl(calls, token = "inventory-token") {
  return async function (...args) {
    calls.push(args);
    if (args[1][0] === "sts") return { stdout: JSON.stringify({ Account: TARGET.awsAccount }) };
    return { stdout: JSON.stringify({ grafanaToken: token, named: "value" }) };
  };
}

test("inventory snapshots one provider result and keeps bearer material out of output and trace", async () => {
  const trace = [];
  const contexts = [];
  const token = "private-token-sentinel";
  const { client } = publicFixture(emptyPlan(), {
    token,
    trace,
    tokenProvider(context) { contexts.push(context); return Promise.resolve(token); },
  });
  const result = await client.readMetadataInventory();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].signal instanceof AbortSignal, true);
  assert.equal(typeof contexts[0].throwIfDeadlineExpired, "function");
  assert.equal(trace.length, 9);
  assert.ok(trace.every((entry) => entry.authorizationPresent && entry.authorizationEqual));
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(trace).includes(token), false);
});

test("credential token grammar and size are fail closed with zero fetches", async (t) => {
  const invalid = [undefined, null, 1, "", " token", "token\n", "tøken", "a=b", "a==b", "=".repeat(2), "a".repeat(8193)];
  for (const token of invalid) {
    await t.test(String(token), async () => {
      let fetches = 0;
      const contexts = [];
      const client = createGrafanaClient({
        tokenProvider: (context) => { contexts.push(context); return token; },
        fetchImpl: async () => { fetches += 1; throw new Error("must not fetch"); },
      });
      const result = await client.readMetadataInventory();
      assertAllCredentialUnavailable(result);
      assert.equal(fetches, 0);
      assert.equal(contexts.length, 1);
      assert.equal(contexts[0].signal instanceof AbortSignal, true);
      assert.equal(typeof contexts[0].throwIfDeadlineExpired, "function");
    });
  }
  const token = "a".repeat(8192);
  const { client, trace } = publicFixture(emptyPlan(), { token });
  assert.equal((await client.readMetadataInventory()).surfaces.api.state, "ok");
  assert.equal(trace.length, 9);
  assert.equal((await publicFixture(emptyPlan(), { token: "abc==" }).client.readMetadataInventory())
    .surfaces.api.state, "ok");
});

test("provider rejection and non-resolution settle as credential_unavailable without a Grafana call", async () => {
  const rejected = createGrafanaClient({ tokenProvider: async () => { throw new Error("provider-prose-sentinel"); },
    fetchImpl: async () => { throw new Error("must not fetch"); } });
  const rejectedResult = await rejected.readMetadataInventory();
  assertAllCredentialUnavailable(rejectedResult);
  assert.equal(JSON.stringify(rejectedResult).includes("provider-prose-sentinel"), false);

  const runtime = controlledRuntime();
  let fetches = 0;
  const resultPromise = readMetadataInventoryInternal({
    target: INVENTORY_TARGET,
    productionClockAndTimers: runtime.dependencies,
    prepareAuthorizedGet: async () => new Promise(() => {}),
  });
  runtime.advance(30_000);
  const result = await resultPromise;
  assertAllCredentialUnavailable(result);
  assert.equal(fetches, 0);
});

test("contextual STS and Secrets Manager launches share the same paired context", async () => {
  const calls = [];
  const controller = new AbortController();
  let guardCalls = 0;
  const guard = () => { guardCalls += 1; };
  const token = await resolveViewerToken({ execFileImpl: validAwsImpl(calls), signal: controller.signal,
    throwIfDeadlineExpired: guard });
  assert.equal(token, "inventory-token");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].length, 3);
  assert.equal(calls[1].length, 3);
  assert.equal(calls[0][2].signal, controller.signal);
  assert.equal(calls[1][2].signal, controller.signal);
  assert.ok(guardCalls >= 2);
});

test("signal-only or guard-only credential context is rejected before AWS work", async () => {
  for (const options of [{ signal: new AbortController().signal }, { throwIfDeadlineExpired() {} }]) {
    let calls = 0;
    await assert.rejects(resolveViewerToken({ ...options, execFileImpl: async () => { calls += 1; } }), /both signal and deadline guard/);
    assert.equal(calls, 0);
  }
  await assert.rejects(runContextualAwsCommand({ execFileImpl: async () => {}, args: [],
    signal: new AbortController().signal }), /signal and deadline guard/);
});

test("a monotonic deadline after late STS prevents Secrets Manager and Grafana launches", async () => {
  const runtime = controlledRuntime();
  const sts = deferred();
  let secrets = 0;
  let fetches = 0;
  const execFileImpl = async (_command, args) => {
    if (args[0] === "sts") return sts.promise;
    secrets += 1;
    return { stdout: JSON.stringify({ grafanaToken: "late-token" }) };
  };
  const resultPromise = readMetadataInventoryInternal({
    target: INVENTORY_TARGET,
    productionClockAndTimers: runtime.dependencies,
    prepareAuthorizedGet: async ({ signal, guard }) => {
      await resolveViewerToken({ execFileImpl, signal, throwIfDeadlineExpired: guard });
      return async () => { fetches += 1; };
    },
  });
  runtime.set(30_000);
  sts.resolve({ stdout: JSON.stringify({ Account: TARGET.awsAccount }) });
  const result = await resultPromise;
  assertAllCredentialUnavailable(result);
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
});

test("timer abort while STS is pending discards late settlement and blocks every dependent launch", async () => {
  const runtime = controlledRuntime();
  const sts = deferred();
  let secrets = 0;
  let fetches = 0;
  const resultPromise = readMetadataInventoryInternal({
    target: INVENTORY_TARGET,
    productionClockAndTimers: runtime.dependencies,
    prepareAuthorizedGet: async ({ signal, guard }) => {
      await resolveViewerToken({ execFileImpl: async (_command, args) => {
        if (args[0] === "sts") return sts.promise;
        secrets += 1;
        return { stdout: JSON.stringify({ grafanaToken: "late-output" }) };
      }, signal, throwIfDeadlineExpired: guard });
      return async () => { fetches += 1; };
    },
  });
  runtime.fireLongest();
  const result = await resultPromise;
  sts.resolve({ stdout: JSON.stringify({ Account: TARGET.awsAccount, late: "late-output" }) });
  await flushMicrotasks();
  assertAllCredentialUnavailable(result);
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
  assert.equal(JSON.stringify(result).includes("late-output"), false);
});

test("abort requests termination of a pending Secrets Manager command", async () => {
  const runtime = controlledRuntime();
  const secret = deferred();
  const calls = [];
  const resultPromise = readMetadataInventoryInternal({
    target: INVENTORY_TARGET,
    productionClockAndTimers: runtime.dependencies,
    prepareAuthorizedGet: async ({ signal, guard }) => {
      await resolveViewerToken({ execFileImpl: async (...args) => {
        calls.push(args);
        if (args[1][0] === "sts") return { stdout: JSON.stringify({ Account: TARGET.awsAccount }) };
        return secret.promise;
      }, signal, throwIfDeadlineExpired: guard });
      throw new Error("must not reach Grafana");
    },
  });
  await flushMicrotasks();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].signal, calls[1][2].signal);
  runtime.fireLongest();
  const result = await resultPromise;
  assertAllCredentialUnavailable(result);
  assert.equal(calls[1][2].signal.aborted, true);
  secret.resolve({ stdout: JSON.stringify({ grafanaToken: "late-secret" }) });
});

function localChildExec(script, lifecycle) {
  return (_command, _args, { signal }) => new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ["-e", script], { signal }, (error, stdout, stderr) => {
      lifecycle.output = `${stdout}${stderr}`;
      if (error) reject(new Error("sanitized child failure"));
      else resolve({ stdout });
    });
    lifecycle.child = child;
    lifecycle.close = new Promise((accept) => child.once("close", accept));
  });
}

for (const fixture of [
  { name: "closes on SIGTERM", handler: "setTimeout(()=>process.exit(0),250)" },
  { name: "ignores SIGTERM", handler: "void 0", ignores: true },
]) {
  test(`credential result is bounded while a direct child ${fixture.name}`, async (t) => {
    const runtime = controlledRuntime();
    const lifecycle = {};
    let dependentLaunches = 0;
    const script = `process.on("SIGTERM",()=>{${fixture.handler}});` +
      `process.stdout.write("ready-child-output-sentinel");process.stderr.write("stderr-child-output-sentinel");setInterval(()=>{},1000);`;
    const resultPromise = readMetadataInventoryInternal({
      target: INVENTORY_TARGET,
      productionClockAndTimers: runtime.dependencies,
      prepareAuthorizedGet: async ({ signal, guard }) => {
        await resolveViewerToken({ execFileImpl: localChildExec(script, lifecycle), signal,
          throwIfDeadlineExpired: guard });
        dependentLaunches += 1;
      },
    });
    let cleanupPromise;
    const cleanup = () => {
      cleanupPromise ??= (async () => {
        const child = lifecycle.child;
        if (!child) return;
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await lifecycle.close;
        lifecycle.output = "";
      })();
      return cleanupPromise;
    };
    t.after(cleanup);
    await once(lifecycle.child.stdout, "data");
    runtime.fireLongest();
    const result = await resultPromise;
    assertAllCredentialUnavailable(result);
    assert.equal(lifecycle.child.killed, true);
    assert.equal(dependentLaunches, 0);
    assert.equal(JSON.stringify(result).includes("child-output-sentinel"), false);
    assert.equal(lifecycle.child.exitCode, null);
    if (fixture.ignores) {
      lifecycle.child.kill("SIGKILL");
    }
    await lifecycle.close;
    assert.equal(lifecycle.output.includes("child-output-sentinel"), true);
  });
}

test("legacy resolver calls remain exact two-argument execFile calls", async () => {
  const calls = [];
  const impl = validAwsImpl(calls);
  assert.equal(await resolveSecretField("secret", "named", { execFileImpl: impl }), "value");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].length, 2);
  assert.equal(calls[1].length, 2);
  const viewerCalls = [];
  assert.equal(await resolveViewerToken({ execFileImpl: validAwsImpl(viewerCalls) }), "inventory-token");
  assert.deepEqual(viewerCalls.map((args) => args.length), [2, 2]);
  const accountCalls = [];
  await assertOperatorAccount(validAwsImpl(accountCalls));
  assert.equal(accountCalls[0].length, 2);

  const failedCalls = [];
  await assert.rejects(assertOperatorAccount(async (...args) => {
    failedCalls.push(args);
    throw new Error("legacy-provider-prose");
  }), /Unable to determine the AWS caller identity/);
  assert.equal(failedCalls[0].length, 2);
});
