/**
 * Disposable self-host EC2 instance: reserve (create key pair, security
 * group, instance; wait for SSH+docker) and register each resource's
 * destructor in the cleanup ledger immediately after it is created — before
 * the resource is used for anything else, per the frozen ledger contract
 * (`../../contracts/cleanup.ts`) and release-worlds-and-fixtures.md's "Every
 * created external resource is registered in the cleanup ledger
 * immediately."
 *
 * This is `prepare()`'s job only: it reserves capacity (an Ubuntu box with
 * Docker installed) and never installs or claims the product — that is a
 * scenario action (see `journey.ts`).
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RUN_TAG_KEY,
  authorizeIngress,
  createKeyPair,
  createSecurityGroup,
  deleteKeyPair,
  deleteSecurityGroup,
  myPublicIp,
  publicIpOf,
  resolveUbuntuAmi,
  runInstance,
  terminateInstance,
  waitInstanceRunning,
  waitInstanceStatusOk,
  waitInstanceTerminated,
  type ExecFn,
} from "./aws-cli.js";
import { sshProbe, type SshTarget } from "./ssh.js";
import type { LocalFileLedger } from "./local-ledger.js";
import { ResourceAlreadyAbsentError } from "./local-ledger.js";

export interface DisposableInstance {
  readonly instanceId: string;
  readonly sgId: string;
  readonly keyName: string;
  readonly keyPath: string;
  readonly publicIp: string;
  readonly sshUser: string;
  readonly dnsName: string;
  readonly region: string;
}

export interface ReserveInstanceOptions {
  readonly exec: ExecFn;
  readonly ledger: LocalFileLedger;
  readonly owningWorld: string;
  readonly runId: string;
  readonly shardId?: string;
  readonly region?: string;
  /** Must match the docker build platform used for the candidate bundle. */
  readonly arch?: "arm64" | "amd64";
  readonly instanceType?: string;
  readonly sshUser?: string;
  /** Test seam: skip the real SSH/docker readiness poll. */
  readonly skipReadinessPoll?: boolean;
  /** Test seam: override the poll attempt count (default 40). */
  readonly readinessPollAttempts?: number;
  /** Test seam: override the poll interval in ms (default 10_000). */
  readonly readinessPollIntervalMs?: number;
}

export interface ReadinessNote {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly observedAt: string;
}

const USER_DATA = `#!/bin/bash
set -eux
export DEBIAN_FRONTEND=noninteractive
for i in $(seq 1 30); do apt-get update && break || sleep 5; done
apt-get install -y docker.io curl
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 || true
fi
if ! docker compose version >/dev/null 2>&1; then
  arch="$(uname -m)"; case "$arch" in aarch64|arm64) ca=aarch64;; *) ca=x86_64;; esac
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-\${ca}" \\
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
systemctl enable --now docker
usermod -aG docker ubuntu
touch /var/lib/cloud/selfhost-ready
`;

/**
 * Reserves a throwaway EC2 instance with Docker installed. Every AWS resource
 * (key pair, security group, instance) is registered in `ledger` — with its
 * own destructor — the instant its creation call returns, before the next
 * resource is created or the box is handed to any installer.
 */
export async function reserveDisposableInstance(
  options: ReserveInstanceOptions,
): Promise<{ instance: DisposableInstance; readiness: ReadinessNote[] }> {
  const region = options.region ?? "us-east-1";
  const arch = options.arch ?? "arm64";
  const instanceType = options.instanceType ?? (arch === "arm64" ? "t4g.small" : "t3.small");
  const sshUser = options.sshUser ?? "ubuntu";
  const readiness: ReadinessNote[] = [];
  const note = (check: string, ok: boolean, detail: string): void => {
    readiness.push({ check, ok, detail, observedAt: new Date().toISOString() });
  };

  const ami = await resolveUbuntuAmi(options.exec, region, arch);
  note("resolve-ami", true, `${arch} Ubuntu 24.04 AMI: ${ami}`);

  const sourceCidr = `${(await myPublicIp(options.exec)).trim()}/32`;

  const suffix = `${options.runId}-${Date.now().toString(36)}`;
  const keyName = `selfhost-e2e-${suffix}`;
  const workDir = await mkdtemp(join(tmpdir(), "selfhost-e2e-"));
  const keyPath = join(workDir, `${keyName}.pem`);

  const keyMaterial = await createKeyPair(options.exec, region, keyName, options.runId);
  await writeFile(keyPath, keyMaterial, { mode: 0o600 });
  const keySequence = await options.ledger.registerResource(
    { runId: options.runId, shardId: options.shardId ?? "", provider: "aws-ec2", resourceType: "key-pair", resourceId: keyName, owningWorld: options.owningWorld },
    async () => {
      await deleteKeyPair(options.exec, region, keyName).catch((error) => {
        if (isAlreadyGone(error)) throw new ResourceAlreadyAbsentError();
        throw error;
      });
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  );
  note("register-key-pair", true, `key pair ${keyName} registered (ledger seq ${keySequence})`);

  const sgId = await createSecurityGroup(options.exec, region, keyName, options.runId);
  await options.ledger.registerResource(
    { runId: options.runId, shardId: options.shardId ?? "", provider: "aws-ec2", resourceType: "security-group", resourceId: sgId, owningWorld: options.owningWorld },
    async () => {
      await deleteSecurityGroup(options.exec, region, sgId).catch((error) => {
        if (isAlreadyGone(error)) throw new ResourceAlreadyAbsentError();
        throw error;
      });
    },
  );
  note("register-security-group", true, `security group ${sgId} registered`);
  await authorizeIngress(options.exec, region, sgId, sourceCidr);

  const userDataFile = join(workDir, "user-data.sh");
  await writeFile(userDataFile, USER_DATA, "utf8");
  const instanceId = await runInstance(options.exec, region, {
    ami,
    instanceType,
    keyName,
    sgId,
    userDataFile,
    runId: options.runId,
  });
  await options.ledger.registerResource(
    { runId: options.runId, shardId: options.shardId ?? "", provider: "aws-ec2", resourceType: "instance", resourceId: instanceId, owningWorld: options.owningWorld },
    async () => {
      await terminateInstance(options.exec, region, instanceId).catch((error) => {
        if (isAlreadyGone(error)) throw new ResourceAlreadyAbsentError();
        throw error;
      });
      await waitInstanceTerminated(options.exec, region, instanceId).catch(() => {});
    },
  );
  note("register-instance", true, `instance ${instanceId} registered (tag ${RUN_TAG_KEY}=${options.runId}, TTL-discoverable)`);

  await waitInstanceRunning(options.exec, region, instanceId);
  note("instance-running", true, `${instanceId} reached running`);
  await waitInstanceStatusOk(options.exec, region, instanceId);
  note("instance-status-ok", true, `${instanceId} passed status checks`);

  const publicIp = await publicIpOf(options.exec, region, instanceId);
  const dnsName = `${publicIp}.sslip.io`;
  const target: SshTarget = { keyPath, sshUser, publicIp };

  if (!options.skipReadinessPoll) {
    const ok = await pollUntil(
      () => sshProbe(options.exec, target, "test -f /var/lib/cloud/selfhost-ready && docker compose version"),
      (out) => out.trim().length > 0,
      options.readinessPollAttempts ?? 40,
      options.readinessPollIntervalMs ?? 10_000,
    );
    note("ssh-docker-ready", ok, ok ? "SSH reachable and docker compose available" : "SSH/docker never came up");
    if (!ok) {
      throw new Error(`reserveDisposableInstance: SSH/docker never came up on ${instanceId} (${publicIp})`);
    }
  }

  return {
    instance: { instanceId, sgId, keyName, keyPath, publicIp, sshUser, dnsName, region },
    readiness,
  };
}

function isAlreadyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /NotFound|InvalidInstanceID\.NotFound|InvalidGroup\.NotFound|InvalidKeyPair\.NotFound|does not exist/i.test(
    message,
  );
}

async function pollUntil<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  attempts: number,
  intervalMs: number,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const value = await producer();
    if (predicate(value)) return true;
    await sleep(intervalMs);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
