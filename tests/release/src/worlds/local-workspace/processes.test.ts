import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CONNECT_PROBE_PATH,
  launchAnyharness,
  launchRendererServer,
  terminateProcess,
  waitForHttpReady,
  type ReadinessFetch,
  type SpawnLike,
} from "./processes.js";

/** Grabs an ephemeral free loopback port for a real static-server spawn. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

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

test("launchRendererServer serves and reports readiness with a hermetic child env", async () => {
  const child = fakeChild();
  let spawnedEnv: NodeJS.ProcessEnv = {};
  const spawn: SpawnLike = (_command, _args, options: SpawnOptions) => {
    spawnedEnv = options.env ?? {};
    return child as unknown as ChildProcess;
  };
  const fetch: ReadinessFetch = async () => okResponse("<html></html>");
  const served = await launchRendererServer({
    rootDir: "/renderer",
    host: "127.0.0.1",
    port: 6001,
    spawn,
    fetch,
  });
  assert.equal(served.baseUrl, "http://127.0.0.1:6001");
  // Symmetry with AnyHarness: the renderer child env is hermetic — no provider
  // or gateway credential passes through the guard.
  for (const key of Object.keys(spawnedEnv)) {
    const upper = key.toUpperCase();
    assert.ok(
      !upper.endsWith("_API_KEY") && !upper.endsWith("_AUTH_TOKEN") &&
        !upper.endsWith("_MASTER_KEY") && !upper.endsWith("_SECRET"),
      `renderer child env leaked "${key}"`,
    );
  }
  await served.process.terminate();
});

test("the real static server serves a bare connect-probe page and preserves SPA fallback", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "renderer-serve-"));
  try {
    const spaMarker = "<html><body id='spa-index'>self-host renderer</body></html>";
    await writeFile(path.join(rootDir, "index.html"), spaMarker, "utf8");
    const port = await freePort();
    // Real spawn + real fetch (no fakes): exercises STATIC_SERVER_SOURCE itself.
    const served = await launchRendererServer({ rootDir, host: "127.0.0.1", port });
    try {
      // The bare probe page: a minimal document, NOT the SPA index (so the
      // product app never boots and fires startup traffic before trust).
      const probe = await fetch(`${served.baseUrl}${CONNECT_PROBE_PATH}`);
      const probeBody = await probe.text();
      assert.equal(probe.status, 200);
      assert.match(probe.headers.get("content-type") ?? "", /text\/html/);
      assert.equal(probeBody, "<!doctype html><title>probe</title>");
      assert.ok(!probeBody.includes("spa-index"), "probe page must not serve the SPA index");

      // SPA fallback is unchanged: an arbitrary deep route still returns the
      // renderer index (local-world PR 1 behavior preserved).
      const spa = await fetch(`${served.baseUrl}/some/deep/app/route`);
      const spaBody = await spa.text();
      assert.equal(spa.status, 200);
      assert.ok(spaBody.includes("spa-index"), "non-probe routes must fall back to the SPA index");
    } finally {
      await served.process.terminate();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
