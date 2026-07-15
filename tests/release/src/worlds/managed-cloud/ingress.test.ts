import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { Ec2IngressBox, Route53Record } from "./ec2.js";
import { deployCandidateApi, type SshExec } from "./ingress.js";

const SERVER_VERSION = "1.2.3";
const MASTER_KEY = "sk-master-SECRET-VALUE";

const BOX: Ec2IngressBox = {
  instanceId: "i-0abcdef",
  securityGroupId: "sg-abc",
  keyName: "mcq-run-1-shard-0-key",
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
      if (command.includes("cat ") && command.includes("setup-token"))
        return { stdout: "SETUP-TOKEN-XYZ\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    async copyFile(_dest, _key, localPath, remotePath) {
      copies.push({ local: localPath, remote: remotePath });
    },
  };
  return { ssh, runs, copies };
}

async function harness(): Promise<{
  runDir: string;
  secretsDir: string;
  serverArtifact: MaterializedArtifact;
  githubSecrets: string;
  githubPrivateKey: string;
  e2bSecrets: string;
  setupTokenHostPath: string;
}> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "ingress-"));
  const secretsDir = path.join(runDir, "secrets");
  const imagePath = path.join(runDir, "server-image.tar");
  await writeFile(imagePath, "server-image-bytes");
  const githubSecrets = path.join(runDir, "github.secrets.env");
  await writeFile(githubSecrets, "GITHUB_APP_CLIENT_SECRET=cs-SECRET\n", { mode: 0o600 });
  const githubPrivateKey = path.join(runDir, "github-app-private-key.pem");
  await writeFile(githubPrivateKey, "-----BEGIN RSA PRIVATE KEY-----\nPEM-SECRET\n-----END RSA PRIVATE KEY-----\n", { mode: 0o600 });
  const e2bSecrets = path.join(runDir, "e2b.secrets.env");
  await writeFile(e2bSecrets, "E2B_API_KEY=e2b-SECRET\n", { mode: 0o600 });
  return {
    runDir,
    secretsDir,
    serverArtifact: { artifact_id: "server/linux/amd64", version: SERVER_VERSION, sha256: "a".repeat(64), path: imagePath },
    githubSecrets,
    githubPrivateKey,
    e2bSecrets,
    setupTokenHostPath: path.join(runDir, "setup-token"),
  };
}

function deployOptions(h: Awaited<ReturnType<typeof harness>>, ssh: SshExec, probeVersion = SERVER_VERSION) {
  return {
    box: BOX,
    record: RECORD,
    serverArtifact: h.serverArtifact,
    litellm: { adminBaseUrl: "http://admin", publicBaseUrl: "http://public", masterKey: MASTER_KEY },
    github: {
      appSlug: "proliferate-cloud-staging",
      appId: "12345",
      clientId: "Iv1.abc",
      installationId: "99887766",
      secretsEnvFilePath: h.githubSecrets,
      privateKeyPemPath: h.githubPrivateKey,
    },
    e2b: { teamId: "team-qual", secretsEnvFilePath: h.e2bSecrets, templateName: "proliferate-runtime-qual-test" },
    publicOrigin: `https://${RECORD.recordName}`,
    rendererOrigin: "http://127.0.0.1:41999",
    secretsDir: h.secretsDir,
    setupTokenHostPath: h.setupTokenHostPath,
    ssh,
    probeHealth: async () => ({ ok: true, version: probeVersion }),
    timeoutMs: 10_000,
  };
}

test("deployCandidateApi loads the exact image, gates on health, and returns the receipt", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    const receipt = await deployCandidateApi(deployOptions(h, f.ssh));

    assert.equal(receipt.artifact_id, `candidate-api/${RECORD.recordName}`);
    assert.equal(receipt.version, SERVER_VERSION);
    assert.equal(receipt.sha256, h.serverArtifact.sha256);
    assert.equal(receipt.publicOrigin, `https://${RECORD.recordName}`);
    assert.equal(receipt.ec2InstanceId, BOX.instanceId);

    // The exact Server image archive was uploaded and loaded, and the migration
    // + Server run used the parsed loaded image ref.
    assert.ok(f.copies.some((c) => c.local === h.serverArtifact.path));
    assert.ok(f.runs.some((c) => c.includes("docker load")));
    assert.ok(f.runs.some((c) => c.includes("alembic upgrade head") && c.includes("candidate-server:candidate")));

    // The setup token was copied DOWN to the runner (0600) for the actor claim.
    assert.equal((await readFile(h.setupTokenHostPath, "utf8")).trim(), "SETUP-TOKEN-XYZ");
    assert.equal((await stat(h.setupTokenHostPath)).mode & 0o777, 0o600);
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("secret VALUES travel only via 0600 env files, never in an SSH command", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    await deployCandidateApi(deployOptions(h, f.ssh));

    // No secret value ever appears in a run() command (argv-equivalent).
    for (const command of f.runs) {
      assert.ok(!command.includes(MASTER_KEY), `master key leaked into: ${command}`);
      assert.ok(!command.includes("PEM-SECRET"), `github key leaked into: ${command}`);
      assert.ok(!command.includes("e2b-SECRET"), `e2b key leaked into: ${command}`);
    }

    // The master key + gateway posture live in the generated 0600 env file that
    // is copied (not argv'd) to the box.
    const serverEnvLocal = path.join(h.secretsDir, "candidate-server.env");
    const envBody = await readFile(serverEnvLocal, "utf8");
    assert.match(envBody, new RegExp(`AGENT_GATEWAY_LITELLM_MASTER_KEY=${MASTER_KEY}`));
    assert.match(envBody, /SINGLE_ORG_MODE=true/);
    assert.match(envBody, /AGENT_GATEWAY_ENABLED=true/);
    assert.match(envBody, /CORS_ALLOW_ORIGINS=http:\/\/127\.0\.0\.1:41999/);
    assert.equal((await stat(serverEnvLocal)).mode & 0o777, 0o600);

    // The App private key + E2B key files were copied up as-is (never read into argv).
    assert.ok(f.copies.some((c) => c.local === h.githubSecrets));
    assert.ok(f.copies.some((c) => c.local === h.e2bSecrets));
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});

test("a Server version that does not match the candidate map fails the deploy", async () => {
  const h = await harness();
  try {
    const f = fakeSsh();
    await assert.rejects(
      deployCandidateApi(deployOptions(h, f.ssh, "9.9.9-wrong")),
      /does not match the candidate map version/,
    );
  } finally {
    await rm(h.runDir, { recursive: true, force: true });
  }
});
