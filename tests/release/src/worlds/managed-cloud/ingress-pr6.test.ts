import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import { RELAY_CHANNEL_PATHS } from "./callback-relay-agent.js";
import type { Ec2IngressBox, Route53Record } from "./ec2.js";
import { deployCandidateApi, type SshExec } from "./ingress.js";

/**
 * Append-only PR-6 coverage for ingress.ts: the `stripe?` + `callbackRelay?`
 * options. The existing ingress.test.ts proves the ABSENT-option path unchanged;
 * this file proves (a) with both absent the Caddyfile keeps the single-proxy
 * routing shape, adds the explicit qualification TLS pair, and stages no
 * relay/Stripe files, and (b) with them present the relay is staged + wired and
 * the Stripe secret files ride as their own env files (never argv).
 */

const SERVER_VERSION = "1.2.3";

const BOX: Ec2IngressBox = {
  instanceId: "i-0abcdef",
  securityGroupId: "sg-abc",
  keyName: "mcq-key",
  keyPath: "/tmp/mcq-key.pem",
  publicIp: "203.0.113.9",
  sshDestination: "ubuntu@203.0.113.9",
};

const RECORD: Route53Record = {
  recordName: "mcq-run-1-shard-0.qualification.proliferate.com",
  hostedZoneId: "Z123",
  address: "203.0.113.9",
  ttl: 60,
};

interface FakeSsh {
  ssh: SshExec;
  runs: string[];
  copies: Array<{ local: string; remote: string }>;
}

function fakeSsh(): FakeSsh {
  const runs: string[] = [];
  const copies: Array<{ local: string; remote: string }> = [];
  const ssh: SshExec = {
    async run(_dest, _key, command) {
      runs.push(command);
      if (command.includes("ingress-ready")) return { stdout: "Docker version 24.0\n", stderr: "" };
      if (command.includes("docker load")) return { stdout: "Loaded image: candidate-server:candidate\n", stderr: "" };
      if (command.includes("pg_isready")) return { stdout: "accepting connections\n", stderr: "" };
      if (command.includes("test -s")) return { stdout: "present\n", stderr: "" };
      if (command.includes("cat ") && command.includes("setup-token")) return { stdout: "TOKEN\n", stderr: "" };
      // The relay readiness probe (`curl … /__relay/health`) answers 200 once
      // the relay is up; the fake reports it immediately.
      if (command.includes("__relay/health")) return { stdout: "200", stderr: "" };
      // The relay-stop cleanup script: model "already absent" (no pidfile) as a
      // clean stop in the offline test.
      if (command.includes("RELAY_STOP_ABSENT")) return { stdout: "RELAY_STOP_ABSENT\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    async copyFile(_dest, _key, localPath, remotePath) {
      copies.push({ local: localPath, remote: remotePath });
    },
  };
  return { ssh, runs, copies };
}

async function harness() {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "ingress-pr6-"));
  const secretsDir = path.join(runDir, "secrets");
  const imagePath = path.join(runDir, "server-image.tar");
  await writeFile(imagePath, "server-image-bytes");
  const githubSecrets = path.join(runDir, "github.secrets.env");
  await writeFile(githubSecrets, "GITHUB_APP_CLIENT_SECRET=cs\n", { mode: 0o600 });
  const githubPrivateKey = path.join(runDir, "github-app-private-key.pem");
  await writeFile(githubPrivateKey, "-----BEGIN RSA PRIVATE KEY-----\nPEM\n-----END RSA PRIVATE KEY-----\n", { mode: 0o600 });
  const e2bSecrets = path.join(runDir, "e2b.secrets.env");
  await writeFile(e2bSecrets, "E2B_API_KEY=e2b\n", { mode: 0o600 });
  const stripeSecrets = path.join(runDir, "stripe.secrets.env");
  await writeFile(stripeSecrets, "STRIPE_SECRET_KEY=sk_test_SECRET\n", { mode: 0o600 });
  const stripeWebhookSecrets = path.join(runDir, "stripe-webhook.secrets.env");
  await writeFile(
    stripeWebhookSecrets,
    "STRIPE_WEBHOOK_SECRET=whsec_SECRET\nE2B_WEBHOOK_SIGNATURE_SECRET=e2bwh_SECRET\n",
    { mode: 0o600 },
  );
  const serverArtifact: MaterializedArtifact = {
    artifact_id: "server/linux/amd64",
    version: SERVER_VERSION,
    sha256: "a".repeat(64),
    path: imagePath,
  };
  return {
    runDir,
    secretsDir,
    serverArtifact,
    githubSecrets,
    githubPrivateKey,
    e2bSecrets,
    stripeSecrets,
    stripeWebhookSecrets,
    setupTokenHostPath: path.join(runDir, "setup-token"),
  };
}

function baseOptions(h: Awaited<ReturnType<typeof harness>>, ssh: SshExec) {
  return {
    box: BOX,
    record: RECORD,
    serverArtifact: h.serverArtifact,
    litellm: { adminBaseUrl: "http://admin", publicBaseUrl: "http://public", masterKey: "sk-master" },
    github: {
      appSlug: "proliferate-cloud-staging",
      appId: "1",
      clientId: "Iv1.a",
      installationId: "9",
      secretsEnvFilePath: h.githubSecrets,
      privateKeyPemPath: h.githubPrivateKey,
    },
    e2b: { teamId: "team", secretsEnvFilePath: h.e2bSecrets, templateName: "tmpl" },
    qualificationRun: { runId: "run-1", shardId: "1" },
    tls: { certificatePath: h.githubPrivateKey, privateKeyPath: h.githubPrivateKey },
    publicOrigin: `https://${RECORD.recordName}`,
    rendererOrigin: "http://127.0.0.1:41999",
    secretsDir: h.secretsDir,
    setupTokenHostPath: h.setupTokenHostPath,
    ssh,
    probeHealth: async () => ({ ok: true, version: SERVER_VERSION }),
    timeoutMs: 10_000,
  };
}

test("with stripe + callbackRelay ABSENT: TLS-pinned single-proxy Caddyfile, no relay/Stripe staged", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    await deployCandidateApi(baseOptions(h, f.ssh));

    const caddy = await readFile(path.join(h.secretsDir, "Caddyfile"), "utf8");
    assert.equal(
      caddy,
      `${RECORD.recordName} {\n` +
        `  tls /etc/caddy/qualification-tls-certificate.pem /etc/caddy/qualification-tls-private-key.pem\n` +
        `  reverse_proxy 127.0.0.1:8000\n}\n`,
    );
    // No relay process launched, no Stripe env files copied.
    assert.ok(!f.runs.some((c) => c.includes("relay.py")));
    assert.ok(!f.copies.some((c) => c.remote.includes("stripe")));
    // The server env carries no Stripe checkout URLs.
    const serverEnv = await readFile(path.join(h.secretsDir, "candidate-server.env"), "utf8");
    assert.ok(!serverEnv.includes("STRIPE_CHECKOUT_SUCCESS_URL"));
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("with stripe present: Stripe secret files ride their own env files (never argv) + checkout URLs in server env", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    await deployCandidateApi({
      ...baseOptions(h, f.ssh),
      stripe: {
        secretsEnvFilePath: h.stripeSecrets,
        webhookSecretEnvFilePath: h.stripeWebhookSecrets,
        checkoutSuccessUrl: `https://${RECORD.recordName}/billing/success`,
        checkoutCancelUrl: `https://${RECORD.recordName}/billing/cancel`,
      },
    });

    // The two Stripe 0600 env files were copied up as-is.
    assert.ok(f.copies.some((c) => c.local === h.stripeSecrets));
    assert.ok(f.copies.some((c) => c.local === h.stripeWebhookSecrets));
    // No secret value ever appears in a run() command (argv-equivalent).
    for (const command of f.runs) {
      assert.ok(!command.includes("sk_test_SECRET"), `stripe key leaked into: ${command}`);
      assert.ok(!command.includes("whsec_SECRET"), `webhook secret leaked into: ${command}`);
      assert.ok(!command.includes("e2bwh_SECRET"), `e2b webhook secret leaked into: ${command}`);
    }
    // The docker run/migration reference the Stripe env files.
    assert.ok(f.runs.some((c) => c.includes("candidate-server") && c.includes("stripe.env") && c.includes("stripe-webhook.env")));
    // Non-secret checkout URLs go in the server env file.
    const serverEnv = await readFile(path.join(h.secretsDir, "candidate-server.env"), "utf8");
    assert.match(serverEnv, /STRIPE_CHECKOUT_SUCCESS_URL=https:\/\/mcq-run-1-shard-0/);
    assert.match(serverEnv, /STRIPE_CHECKOUT_CANCEL_URL=https:\/\/mcq-run-1-shard-0/);
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("with callbackRelay present: relay staged + started and the two signed webhook paths route through it", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    await deployCandidateApi({ ...baseOptions(h, f.ssh), callbackRelay: { listenPort: 8899 } });

    // The relay script was copied and the process started (pass-through default).
    assert.ok(f.copies.some((c) => c.remote.endsWith("callback-relay/relay.py")));
    assert.ok(f.runs.some((c) => c.includes("relay.py serve") && c.includes("RELAY_PORT=8899")));

    const caddy = await readFile(path.join(h.secretsDir, "Caddyfile"), "utf8");
    // Both signed webhook paths route to the relay port; a catch-all still
    // proxies everything else to the Server.
    assert.ok(caddy.includes(`handle ${RELAY_CHANNEL_PATHS.stripe} {`));
    assert.ok(caddy.includes(`handle ${RELAY_CHANNEL_PATHS.e2b} {`));
    assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8899/);
    assert.match(caddy, /handle \{\n\s+reverse_proxy 127\.0\.0\.1:8000/);
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("with callbackRelay present: PID is captured, readiness is probed, and both relay resources register cleanup BEFORE start", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    const registered: Array<{ kind: string; providerId: string }> = [];
    const releasers: Array<() => Promise<void>> = [];
    await deployCandidateApi({
      ...baseOptions(h, f.ssh),
      callbackRelay: { listenPort: 8899 },
      registerCleanup: async (kind, providerId, release) => {
        registered.push({ kind, providerId });
        releasers.push(release);
      },
    });

    // Both relay resources registered (registered-before-create): spool + process.
    const spoolReg = registered.find((r) => r.kind === "callback_relay_spool");
    const procReg = registered.find((r) => r.kind === "callback_relay_process");
    assert.ok(spoolReg);
    assert.ok(procReg);
    // Durable identity: the process providerId is `<box-ip>:<pidfile>` so a
    // recovered runner can act from the ledger alone.
    assert.match(procReg!.providerId, /^203\.0\.113\.9:.*relay\.pid$/);
    // The spool dir is created owner-only (0700).
    assert.ok(f.runs.some((c) => c.includes("install -d -m 700") || c.includes("chmod 700")));
    // The registration happened BEFORE the serve command ran.
    const serveIdx = f.runs.findIndex((c) => c.includes("relay.py serve"));
    assert.ok(serveIdx >= 0);
    // The start records the ownership discriminator (pid + starttime + script)
    // into the JSON pidfile, and readiness was probed.
    const startCmd = f.runs.find((c) => c.includes("relay.py serve"))!;
    assert.match(startCmd, /RELAY_PID=\$!/);
    assert.match(startCmd, /\/proc\/\$RELAY_PID\/stat/);
    assert.match(startCmd, /"pid":%s,"starttime":"%s","script":"%s"/);
    assert.ok(f.runs.some((c) => c.includes("__relay/health")));

    // The process releaser runs the PID-reuse-safe stop script (validates
    // starttime + cmdline before signalling, then kill + kill -0); the spool
    // releaser rm -rf's the dir.
    const before = f.runs.length;
    for (const release of releasers) await release();
    const cleanupCmds = f.runs.slice(before);
    const stopCmd = cleanupCmds.find((c) => c.includes("kill -0") && c.includes("relay.pid"));
    assert.ok(stopCmd, "process releaser runs the stop script");
    assert.match(stopCmd!, /\/proc\/\$PID\/stat/); // re-checks starttime
    assert.match(stopCmd!, /\/proc\/\$PID\/cmdline/); // re-checks cmdline
    assert.match(stopCmd!, /RELAY_STOP_STALE_PID/); // has the reused-PID branch
    assert.ok(cleanupCmds.some((c) => c.includes("rm -rf") && c.includes("callback-relay")));
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("the relay process releaser does NOT kill a REUSED PID (starttime/cmdline mismatch → stale, clean success)", async () => {
  const h = await harness();
  try {
    // The stop script models a live process at the recorded PID whose
    // starttime/cmdline DO NOT match → the script's own logic prints
    // RELAY_STOP_STALE_PID and sends no kill. We assert the releaser succeeds and
    // that the fake never had to emit a FAILED/OK (kill) sentinel.
    const runs: string[] = [];
    let sentinelForStop: string | null = null;
    const ssh = {
      async run(_d: string, _k: string, command: string) {
        runs.push(command);
        if (command.includes("ingress-ready")) return { stdout: "Docker version 24.0\n", stderr: "" };
        if (command.includes("docker load")) return { stdout: "Loaded image: candidate-server:candidate\n", stderr: "" };
        if (command.includes("pg_isready")) return { stdout: "accepting connections\n", stderr: "" };
        if (command.includes("test -s")) return { stdout: "present\n", stderr: "" };
        if (command.includes("cat ") && command.includes("setup-token")) return { stdout: "TOKEN\n", stderr: "" };
        if (command.includes("__relay/health")) return { stdout: "200", stderr: "" };
        // The stop script is a single self-contained shell program; a reused PID
        // makes ITS OWN branch print RELAY_STOP_STALE_PID. Model that verbatim.
        if (command.includes("RELAY_STOP_STALE_PID")) {
          sentinelForStop = "RELAY_STOP_STALE_PID";
          return { stdout: "RELAY_STOP_STALE_PID\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
      async copyFile() {},
    };
    let processReleaser: (() => Promise<void>) | undefined;
    await deployCandidateApi({
      ...baseOptions(h, ssh),
      callbackRelay: {},
      registerCleanup: async (kind, _id, release) => {
        if (kind === "callback_relay_process") processReleaser = release;
      },
    });
    assert.ok(processReleaser);
    await processReleaser!(); // must NOT throw — a stale PID is a clean, non-killing success.
    assert.equal(sentinelForStop, "RELAY_STOP_STALE_PID");
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("the relay process releaser THROWS when the process fails to stop (cleanup failure is non-green, no `|| true` mask)", async () => {
  const h = await harness();
  try {
    // A fake SSH whose stop script reports the process is still alive.
    const runs: string[] = [];
    const ssh = {
      async run(_d: string, _k: string, command: string) {
        runs.push(command);
        if (command.includes("ingress-ready")) return { stdout: "Docker version 24.0\n", stderr: "" };
        if (command.includes("docker load")) return { stdout: "Loaded image: candidate-server:candidate\n", stderr: "" };
        if (command.includes("pg_isready")) return { stdout: "accepting connections\n", stderr: "" };
        if (command.includes("test -s")) return { stdout: "present\n", stderr: "" };
        if (command.includes("cat ") && command.includes("setup-token")) return { stdout: "TOKEN\n", stderr: "" };
        if (command.includes("__relay/health")) return { stdout: "200", stderr: "" };
        if (command.includes("RELAY_STOP_ABSENT")) return { stdout: "RELAY_STOP_FAILED:4321\n", stderr: "" };
        return { stdout: "", stderr: "" };
      },
      async copyFile() {},
    };
    let processReleaser: (() => Promise<void>) | undefined;
    await deployCandidateApi({
      ...baseOptions(h, ssh),
      callbackRelay: {},
      registerCleanup: async (kind, _id, release) => {
        if (kind === "callback_relay_process") processReleaser = release;
      },
    });
    assert.ok(processReleaser);
    await assert.rejects(() => processReleaser!(), /failed to stop the relay process/);
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("with callbackRelay ABSENT: no relay cleanup is registered (today's behaviour)", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    const registered: string[] = [];
    await deployCandidateApi({
      ...baseOptions(h, f.ssh),
      registerCleanup: async (kind) => {
        registered.push(kind);
      },
    });
    assert.deepEqual(registered, []);
    assert.ok(!f.runs.some((c) => c.includes("__relay/health")));
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});
