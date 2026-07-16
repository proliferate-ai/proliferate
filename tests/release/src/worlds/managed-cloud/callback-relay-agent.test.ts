import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { CALLBACK_RELAY_SCRIPT } from "./callback-relay-agent.js";

/**
 * Focused EXECUTION tests for the on-box signed-callback relay: they run the
 * ACTUAL relay Python script locally against a tiny stub upstream http server on
 * loopback (offline; no box, no network egress). They cover the correctness
 * properties the TypeScript transport fakes cannot exercise: hold-buffering,
 * byte-identical forward (sha256), atomic mode change, one-shot replay, terminal
 * state, and non-2xx propagation.
 *
 * Skipped cleanly (with a visible reason) only when python3 is absent.
 */

const PYTHON3_AVAILABLE = (() => {
  try {
    return spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

const skip = PYTHON3_AVAILABLE ? undefined : { skip: "python3 not available on this host" };

/** A stub upstream that records every received request (path, headers, exact body) and answers a scripted status. */
interface StubUpstream {
  server: Server;
  port: number;
  received: Array<{ path: string; headers: IncomingMessage["headers"]; body: Buffer }>;
  setStatus(status: number): void;
  close(): Promise<void>;
}

async function startStubUpstream(): Promise<StubUpstream> {
  const received: StubUpstream["received"] = [];
  let status = 200;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    server,
    port,
    received,
    setStatus(next) {
      status = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function writeRelayScript(dir: string): Promise<string> {
  const scriptPath = path.join(dir, "relay.py");
  await writeFile(scriptPath, CALLBACK_RELAY_SCRIPT, { mode: 0o755 });
  return scriptPath;
}

function relayEnv(spoolDir: string, upstreamPort: number, servePort?: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RELAY_SPOOL_DIR: spoolDir,
    RELAY_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
    ...(servePort ? { RELAY_PORT: String(servePort) } : {}),
  };
}

/**
 * Runs a one-shot relay action (set-mode/replay/replay-held); returns exit code
 * + stderr. Uses async `spawn` (NOT spawnSync) so the in-process stub upstream's
 * event loop keeps running while a replay action connects to it — spawnSync
 * would block Node's loop and the replay's forward would hang.
 */
function runRelayAction(
  scriptPath: string,
  spoolDir: string,
  upstreamPort: number,
  args: string[],
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, ...args], { env: relayEnv(spoolDir, upstreamPort) });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (status) => resolve({ status, stderr }));
  });
}

async function pollRelayHealth(port: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/__relay/health", method: "GET", timeout: 500 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (ok) return;
    if (Date.now() >= deadline) throw new Error("relay never became healthy");
    await delay(100);
  }
}

/** POST bytes to the running relay on `path`; resolves with the relay's status + body. */
function postToRelay(
  port: number,
  urlPath: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: { "Content-Length": String(body.length), ...headers },
        timeout: 5_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("relay POST timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function startServe(
  scriptPath: string,
  spoolDir: string,
  upstreamPort: number,
): Promise<{ child: ChildProcess; port: number }> {
  // Bind a fixed ephemeral port chosen by asking the OS via a throwaway server.
  const probe = createServer();
  const port: number = await new Promise((resolve) =>
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const p = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(p));
    }),
  );
  const child = spawn("python3", [scriptPath, "serve"], {
    env: relayEnv(spoolDir, upstreamPort, port),
    stdio: "ignore",
  });
  await pollRelayHealth(port);
  return { child, port };
}

async function withSpool<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "relay-exec-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("relay: /__relay/health answers 200 and is never forwarded upstream", skip ?? {}, async () => {
  await withSpool(async (dir) => {
    const upstream = await startStubUpstream();
    const scriptPath = await writeRelayScript(dir);
    const { child, port } = await startServe(scriptPath, dir, upstream.port);
    try {
      await pollRelayHealth(port);
      assert.equal(upstream.received.length, 0, "health probe must not reach upstream");
    } finally {
      child.kill();
      await upstream.close();
    }
  });
});

test("relay: pass-through forwards byte-identically (sha256 of the exact bytes matches upstream)", skip ?? {}, async () => {
  await withSpool(async (dir) => {
    const upstream = await startStubUpstream();
    const scriptPath = await writeRelayScript(dir);
    const { child, port } = await startServe(scriptPath, dir, upstream.port);
    try {
      const body = Buffer.from(JSON.stringify({ id: "evt_1", nested: { x: [1, 2, 3] } }));
      const sig = "t=123,v1=deadbeef";
      const res = await postToRelay(port, "/v1/billing/webhooks/stripe", body, { "Stripe-Signature": sig });
      assert.equal(res.status, 200);
      assert.equal(upstream.received.length, 1);
      const forwarded = upstream.received[0];
      // Byte-identical body.
      assert.equal(
        createHash("sha256").update(forwarded.body).digest("hex"),
        createHash("sha256").update(body).digest("hex"),
      );
      // The signed header rode untouched.
      assert.equal(forwarded.headers["stripe-signature"], sig);
    } finally {
      child.kill();
      await upstream.close();
    }
  });
});

test("relay: hold buffers (2xx ack, NOT forwarded); one-shot replay forwards exactly once, byte-identical", skip ?? {}, async () => {
  await withSpool(async (dir) => {
    const upstream = await startStubUpstream();
    const scriptPath = await writeRelayScript(dir);
    const { child, port } = await startServe(scriptPath, dir, upstream.port);
    try {
      // Atomic mode change to hold.
      const setMode = await runRelayAction(scriptPath, dir, upstream.port, ["set-mode", "stripe", "hold"]);
      assert.equal(setMode.status, 0);

      const body = Buffer.from(JSON.stringify({ id: "evt_hold" }));
      const held = await postToRelay(port, "/v1/billing/webhooks/stripe", body, { "Stripe-Signature": "sig-h" });
      assert.equal(held.status, 200); // ack
      assert.equal(upstream.received.length, 0, "a held delivery must NOT be forwarded");

      // The manifest records the held delivery; recover its id.
      const manifest = await readFile(path.join(dir, "manifest.jsonl"), "utf8");
      const heldRow = manifest
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
        .find((r) => r.state === "held");
      assert.ok(heldRow, "a held row must be recorded");

      // replay-held forwards it once, byte-identically with the signed header.
      const replay = await runRelayAction(scriptPath, dir, upstream.port, ["replay-held", "stripe"]);
      assert.equal(replay.status, 0, replay.stderr);
      assert.equal(upstream.received.length, 1);
      assert.equal(upstream.received[0].headers["stripe-signature"], "sig-h");
      assert.equal(
        createHash("sha256").update(upstream.received[0].body).digest("hex"),
        createHash("sha256").update(body).digest("hex"),
      );

      // Terminal state: a SECOND replay-held must NOT re-forward it.
      const replayAgain = await runRelayAction(scriptPath, dir, upstream.port, ["replay-held", "stripe"]);
      assert.equal(replayAgain.status, 0, replayAgain.stderr);
      assert.equal(upstream.received.length, 1, "replay-held must be one-shot (terminal state)");
    } finally {
      child.kill();
      await upstream.close();
    }
  });
});

test("relay: a corrupt control file fails CLOSED (treated as hold, delivery buffered not forwarded)", skip ?? {}, async () => {
  await withSpool(async (dir) => {
    const upstream = await startStubUpstream();
    const scriptPath = await writeRelayScript(dir);
    const { child, port } = await startServe(scriptPath, dir, upstream.port);
    try {
      // A present-but-corrupt control file: unknown state during a possible hold.
      await writeFile(path.join(dir, "control-stripe.json"), "{ this is not json");
      const body = Buffer.from(JSON.stringify({ id: "evt_corrupt" }));
      const res = await postToRelay(port, "/v1/billing/webhooks/stripe", body);
      assert.equal(res.status, 200); // ack (buffered)
      assert.equal(upstream.received.length, 0, "a corrupt control file must fail closed (buffer, never forward)");
    } finally {
      child.kill();
      await upstream.close();
    }
  });
});

test("relay: a non-2xx replay stays RETRYABLE (held), exits nonzero; a later replay after recovery succeeds and terminalizes", skip ?? {}, async () => {
  await withSpool(async (dir) => {
    const upstream = await startStubUpstream();
    const scriptPath = await writeRelayScript(dir);
    const { child, port } = await startServe(scriptPath, dir, upstream.port);
    try {
      await runRelayAction(scriptPath, dir, upstream.port, ["set-mode", "e2b", "hold"]);
      const body = Buffer.from(JSON.stringify({ id: "evt_500" }));
      await postToRelay(port, "/v1/cloud/webhooks/e2b", body);
      assert.equal(upstream.received.length, 0);

      // First replay: upstream 500 → nonzero exit, delivery LEFT in held (the
      // provider was already ack'd and will not resend, so it must remain
      // retryable — not terminalized).
      upstream.setStatus(500);
      const failed = await runRelayAction(scriptPath, dir, upstream.port, ["replay-held", "e2b"]);
      assert.notEqual(failed.status, 0, "a non-2xx replay must propagate a nonzero exit");
      assert.equal(upstream.received.length, 1);
      const manifestAfterFail = await readFile(path.join(dir, "manifest.jsonl"), "utf8");
      assert.match(manifestAfterFail, /"state": "replay_failed:500"/);
      assert.doesNotMatch(manifestAfterFail, /"state": "replayed:/, "must NOT terminalize on a non-2xx");
      // Still in held (retryable), with a last_status sidecar recorded.
      const { readdir } = await import("node:fs/promises");
      const heldFiles = await readdir(path.join(dir, "held"));
      assert.ok(heldFiles.some((n) => n.endsWith(".meta.json")), "delivery must remain held/retryable");
      assert.ok(heldFiles.some((n) => n.endsWith(".last_status.json")), "last_status sidecar recorded");

      // Upstream recovers: a subsequent replay-held succeeds and THEN terminalizes.
      upstream.setStatus(200);
      const ok = await runRelayAction(scriptPath, dir, upstream.port, ["replay-held", "e2b"]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(upstream.received.length, 2, "the recovered replay re-forwarded the retryable delivery");
      const manifestAfterOk = await readFile(path.join(dir, "manifest.jsonl"), "utf8");
      assert.match(manifestAfterOk, /"state": "replayed:200"/);
      // Terminal now: a further replay-held is a no-op.
      const noop = await runRelayAction(scriptPath, dir, upstream.port, ["replay-held", "e2b"]);
      assert.equal(noop.status, 0);
      assert.equal(upstream.received.length, 2, "a terminalized delivery is never re-selected");
    } finally {
      child.kill();
      await upstream.close();
    }
  });
});

test("relay: set-mode writes are atomic (no leftover tmp file, control file parses)", skip ?? {}, async () => {
  await withSpool(async (dir) => {
    const upstream = await startStubUpstream();
    const scriptPath = await writeRelayScript(dir);
    try {
      const r = await runRelayAction(scriptPath, dir, upstream.port, ["set-mode", "stripe", "hold"]);
      assert.equal(r.status, 0);
      const control = JSON.parse(await readFile(path.join(dir, "control-stripe.json"), "utf8"));
      assert.equal(control.mode, "hold");
      const { readdir } = await import("node:fs/promises");
      const leftover = (await readdir(dir)).filter((n) => n.includes(".tmp-"));
      assert.deepEqual(leftover, [], "no tmp file should linger after an atomic rename");
    } finally {
      await upstream.close();
    }
  });
});

test("relay: spool dirs are 0700 and every delivery/control/manifest file is 0600 (signature material is owner-only)", skip ?? {}, async () => {
  await withSpool(async (dir) => {
    const upstream = await startStubUpstream();
    const scriptPath = await writeRelayScript(dir);
    const { child, port } = await startServe(scriptPath, dir, upstream.port);
    try {
      await runRelayAction(scriptPath, dir, upstream.port, ["set-mode", "stripe", "hold"]);
      const body = Buffer.from(JSON.stringify({ id: "evt_perm" }));
      await postToRelay(port, "/v1/billing/webhooks/stripe", body, { "Stripe-Signature": "sig-perm" });

      const { stat, readdir } = await import("node:fs/promises");
      const mode = (p: string) => stat(p).then((s) => s.mode & 0o777);

      // Dirs 0700.
      assert.equal(await mode(path.join(dir, "held")), 0o700);
      assert.equal(await mode(path.join(dir, "replayed")), 0o700);
      // Control + manifest 0600.
      assert.equal(await mode(path.join(dir, "control-stripe.json")), 0o600);
      assert.equal(await mode(path.join(dir, "manifest.jsonl")), 0o600);
      // Every held delivery file (bin/headers/meta — the signed material) is 0600.
      const heldDir = path.join(dir, "held");
      for (const name of await readdir(heldDir)) {
        assert.equal(await mode(path.join(heldDir, name)), 0o600, `held/${name} must be 0600`);
      }
    } finally {
      child.kill();
      await upstream.close();
    }
  });
});
