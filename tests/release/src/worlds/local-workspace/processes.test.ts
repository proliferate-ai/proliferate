import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  launchAnyharness,
  launchRendererServer,
  terminateProcess,
  waitForHttpReady,
  type ReadinessFetch,
  type SpawnLike,
} from "./processes.js";

interface FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: string | null;
  stderr: EventEmitter;
  kill(signal?: string): boolean;
}

function fakeChild(): FakeChild {
  const emitter = new EventEmitter() as FakeChild;
  emitter.pid = 4242;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.stderr = new EventEmitter();
  emitter.kill = (signal = "SIGTERM") => {
    emitter.signalCode = signal;
    setImmediate(() => emitter.emit("exit", 0, signal));
    return true;
  };
  return emitter;
}

function okResponse(body: unknown): { ok: boolean; status: number; json(): Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body };
}

test("waitForHttpReady resolves once the endpoint responds OK", async () => {
  let attempts = 0;
  const fetch: ReadinessFetch = async () => {
    attempts += 1;
    if (attempts < 2) {
      throw new Error("connection refused");
    }
    return okResponse({});
  };
  await waitForHttpReady("http://127.0.0.1:1/health", { timeoutMs: 2_000, fetch });
  assert.equal(attempts, 2);
});

test("waitForHttpReady rejects on a bounded timeout", async () => {
  const fetch: ReadinessFetch = async () => {
    throw new Error("refused");
  };
  await assert.rejects(waitForHttpReady("http://127.0.0.1:1/health", { timeoutMs: 300, fetch }), /did not become ready/);
});

test("terminateProcess SIGTERMs and resolves on exit", async () => {
  const child = fakeChild();
  let killed: string | undefined;
  child.kill = (signal = "SIGTERM") => {
    killed = signal;
    setImmediate(() => child.emit("exit", 0, signal));
    return true;
  };
  await terminateProcess(child as unknown as ChildProcess);
  assert.equal(killed, "SIGTERM");
});

test("launchAnyharness launches, waits for /health, and returns parsed health", async () => {
  const child = fakeChild();
  let spawnedArgs: readonly string[] = [];
  let spawnedEnv: NodeJS.ProcessEnv = {};
  const spawn: SpawnLike = (_command, args, options: SpawnOptions) => {
    spawnedArgs = args;
    spawnedEnv = options.env ?? {};
    return child as unknown as ChildProcess;
  };
  const fetch: ReadinessFetch = async () =>
    okResponse({ status: "ok", version: "9.9.9", runtimeHome: "/run/home" });

  const result = await launchAnyharness({
    binaryPath: "/bin/anyharness",
    host: "127.0.0.1",
    port: 5555,
    runtimeHome: "/run/home",
    // A caller env carrying a provider secret must be scrubbed out of the child.
    env: { PATH: "/usr/bin", ANTHROPIC_AUTH_TOKEN: "secret-should-be-dropped" },
    spawn,
    fetch,
  });

  assert.equal(result.health.version, "9.9.9");
  assert.equal(result.baseUrl, "http://127.0.0.1:5555");
  assert.deepEqual(spawnedArgs, ["serve", "--host", "127.0.0.1", "--port", "5555", "--runtime-home", "/run/home"]);
  assert.equal(spawnedEnv.PATH, "/usr/bin");
  assert.equal(spawnedEnv.ANTHROPIC_AUTH_TOKEN, undefined);

  await result.process.terminate();
});

test("launchAnyharness fails if the process exits before health", async () => {
  const child = fakeChild();
  const spawn: SpawnLike = () => {
    setImmediate(() => child.emit("exit", 1));
    return child as unknown as ChildProcess;
  };
  const fetch: ReadinessFetch = async () => {
    throw new Error("refused");
  };
  await assert.rejects(
    launchAnyharness({ binaryPath: "/bin/x", host: "127.0.0.1", port: 5556, runtimeHome: "/h", spawn, fetch }),
    /exited before becoming healthy/,
  );
});

test("launchRendererServer serves and reports readiness", async () => {
  const child = fakeChild();
  const spawn: SpawnLike = () => child as unknown as ChildProcess;
  const fetch: ReadinessFetch = async () => okResponse("<html></html>");
  const served = await launchRendererServer({
    rootDir: "/renderer",
    host: "127.0.0.1",
    port: 6001,
    spawn,
    fetch,
  });
  assert.equal(served.baseUrl, "http://127.0.0.1:6001");
  await served.process.terminate();
});
