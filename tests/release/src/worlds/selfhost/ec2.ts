import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { CleanupResourceKind } from "../local-workspace/cleanup-ledger.js";

/**
 * The run-scoped EC2 provisioner contract (frozen spec "World construction"
 * step 2). Reuses the proven `run-instances` shell-out shape from
 * `tests/release/scripts/selfhost-box.sh`: a dedicated, clearly-tagged security
 * group (80/443 world + 22 to the runner IP only) and a unique key pair in the
 * default VPC. Never touches `proliferate-prod*`. Every resource is registered
 * in the cleanup ledger BEFORE it is created (registered-before-create), using a
 * deterministic run-scoped identity so the releaser is correct even if the
 * process crashes between the ledger write and the AWS create call (mirrors the
 * `docker.ts` network/container pattern in the local world).
 *
 * All AWS access goes through the injectable `Ec2Exec` seam so unit tests run
 * fully offline (no real AWS). The seam shells the `aws` CLI with ambient
 * credentials — never credential values on argv.
 */

/** Injectable AWS CLI seam. `run` returns stdout, throwing on non-zero exit. */
export interface Ec2Exec {
  run(args: readonly string[], options?: { timeoutMs?: number }): Promise<string>;
}

/** Resolves this runner's public IPv4 for the `/32` SSH ingress rule. */
export type PublicIpResolver = () => Promise<string>;

/** Minimal SSH command seam (a full `SshTransport` is structurally assignable). */
export interface SshRunner {
  run(command: string, options?: { timeoutMs?: number }): Promise<string>;
}

/** The coordinates of a provisioned box (no secrets; keyPath points at a 0600 file). */
export interface Ec2Box {
  instanceId: string;
  securityGroupId: string;
  keyName: string;
  /** 0600 private-key file path (the key material is the secret, never argv). */
  keyPath: string;
  publicIp: string;
  sshUser: string;
}

export interface Ec2ProvisionInputs {
  region: string;
  instanceType: string;
  /** `<ip>/32` for the SSH ingress rule (resolved from the runner's public IP). */
  runnerCidr: string;
  /** Run-scoped, collision-free key-pair name (also the SG name). */
  keyName: string;
  /** Run-scoped SG name (defaults to keyName). */
  securityGroupName: string;
  sshUser: string;
  /** Run-scoped resource tags (Purpose/Name + run id/shard). */
  tags: Record<string, string>;
  /** Directory the 0600 private key is written to. */
  keyDir: string;
}

export interface ProvisionEc2Options {
  inputs: Ec2ProvisionInputs;
  exec?: Ec2Exec;
  log?: (message: string) => void;
  timeoutMs?: number;
  /** Registered-before-create: called for key_pair, security_group, ec2_instance. */
  registerCleanup(
    kind: Extract<CleanupResourceKind, "ec2_instance" | "security_group" | "key_pair">,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void>;
}

/** The instance tag key whose run-scoped value scopes tag-based teardown. */
const INSTANCE_NAME_TAG = "Name";
const PURPOSE_TAG_VALUE = "self-hosting-qualification";
/** SSM public parameters for the latest Ubuntu 24.04 AMIs. */
const UBUNTU_24_04_AMI_PARAM: Record<"amd64" | "arm64", string> = {
  amd64: "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id",
  arm64: "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id",
};

/**
 * The cloud-init user-data that installs docker + compose on a stock Ubuntu box
 * and drops a readiness marker. Ported verbatim (behaviour-preserving) from the
 * proven `selfhost-box.sh` so the box the shipped installer runs on is the exact
 * operator environment.
 */
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
 * Provisions the run-scoped box: create key pair → create SG + ingress →
 * run-instances (Ubuntu 24.04, docker via cloud-init user-data) → wait
 * instance-running + status-ok → resolve the public IP. Each resource is
 * registered in the ledger before its creation call, keyed by its deterministic
 * run-scoped identity (key/SG name, instance Name tag) so a crash between the
 * ledger write and the create leaves a correct, idempotent releaser. Returns
 * once the instance is running; SSH/cloud-init readiness is a separate bounded
 * gate.
 */
export async function provisionEc2Box(options: ProvisionEc2Options): Promise<Ec2Box> {
  const exec = options.exec ?? defaultEc2Exec;
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs;
  const { region, instanceType, runnerCidr, keyName, securityGroupName, sshUser, keyDir } = options.inputs;
  const keyPath = path.join(keyDir, `${keyName}.pem`);
  const arch = amiArchForInstanceType(instanceType);

  log(`resolving latest Ubuntu 24.04 ${arch} AMI in ${region}`);
  const ami = (
    await exec.run(
      ["ssm", "get-parameters", "--region", region, "--names", UBUNTU_24_04_AMI_PARAM[arch], "--query", "Parameters[0].Value", "--output", "text"],
      { timeoutMs },
    )
  ).trim();
  if (!ami || ami === "None") {
    throw new Error(`Could not resolve the Ubuntu 24.04 ${arch} AMI in ${region}.`);
  }

  // key pair — registered before create; released by deterministic name.
  await options.registerCleanup("key_pair", keyName, () => deleteKeyPair(exec, region, keyName, keyPath, log));
  log(`creating key pair ${keyName}`);
  const keyMaterial = await exec.run(
    ["ec2", "create-key-pair", "--region", region, "--key-name", keyName, "--query", "KeyMaterial", "--output", "text"],
    { timeoutMs },
  );
  await writeFile(keyPath, keyMaterial.endsWith("\n") ? keyMaterial : `${keyMaterial}\n`, { mode: 0o600 });

  // security group — registered before create; released by deterministic name.
  await options.registerCleanup("security_group", securityGroupName, () =>
    deleteSecurityGroupByName(exec, region, securityGroupName, log),
  );
  log(`creating security group ${securityGroupName}`);
  const securityGroupId = (
    await exec.run(
      [
        "ec2",
        "create-security-group",
        "--region",
        region,
        "--group-name",
        securityGroupName,
        "--description",
        "Proliferate self-host qualification (throwaway)",
        "--tag-specifications",
        `ResourceType=security-group,${tagSpec(options.inputs.tags)}`,
        "--query",
        "GroupId",
        "--output",
        "text",
      ],
      { timeoutMs },
    )
  ).trim();
  await exec.run(
    [
      "ec2",
      "authorize-security-group-ingress",
      "--region",
      region,
      "--group-id",
      securityGroupId,
      "--ip-permissions",
      "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]",
      "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]",
      `IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${runnerCidr}}]`,
    ],
    { timeoutMs },
  );

  // instance — registered before create; released by its run-scoped Name tag
  // (run-instances returns a non-deterministic id, so the tag is the identity
  // that is knowable before the create and cannot collide with another run).
  await options.registerCleanup("ec2_instance", keyName, () => terminateInstancesByNameTag(exec, region, keyName, log));

  const userDataDir = await mkdtemp(path.join(keyDir, "userdata-"));
  const userDataFile = path.join(userDataDir, "user-data.sh");
  await writeFile(userDataFile, USER_DATA, { mode: 0o600 });
  try {
    log(`launching ${instanceType} instance`);
    const instanceId = (
      await exec.run(
        [
          "ec2",
          "run-instances",
          "--region",
          region,
          "--image-id",
          ami,
          "--instance-type",
          instanceType,
          "--key-name",
          keyName,
          "--security-group-ids",
          securityGroupId,
          "--block-device-mappings",
          "DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}",
          "--user-data",
          `file://${userDataFile}`,
          "--tag-specifications",
          `ResourceType=instance,${tagSpec({ ...options.inputs.tags, [INSTANCE_NAME_TAG]: keyName })}`,
          "--query",
          "Instances[0].InstanceId",
          "--output",
          "text",
        ],
        { timeoutMs },
      )
    ).trim();
    if (!instanceId || instanceId === "None") {
      throw new Error("run-instances returned no instance id.");
    }
    log(`instance ${instanceId} launched; waiting for instance-running`);
    await exec.run(["ec2", "wait", "instance-running", "--region", region, "--instance-ids", instanceId], { timeoutMs });
    await exec.run(["ec2", "wait", "instance-status-ok", "--region", region, "--instance-ids", instanceId], { timeoutMs });
    const publicIp = await resolveRunnerBoxPublicIp(exec, region, instanceId, timeoutMs);

    return { instanceId, securityGroupId, keyName, keyPath, publicIp, sshUser };
  } finally {
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Resolves the running box's public IP (distinct from the runner's own IP). */
async function resolveRunnerBoxPublicIp(
  exec: Ec2Exec,
  region: string,
  instanceId: string,
  timeoutMs: number | undefined,
): Promise<string> {
  const ip = (
    await exec.run(
      ["ec2", "describe-instances", "--region", region, "--instance-ids", instanceId, "--query", "Reservations[0].Instances[0].PublicIpAddress", "--output", "text"],
      { timeoutMs },
    )
  ).trim();
  if (!ip || ip === "None") {
    throw new Error(`Instance ${instanceId} has no public IP.`);
  }
  return ip;
}

/**
 * Terminates the instance and deletes the throwaway SG + key pair using the
 * concrete ids captured on the box. Composes the same per-resource helpers the
 * ledger releasers use; provided for manual/recovery teardown (the world's
 * normal teardown runs the three per-resource ledger releaters in reverse
 * order so each cleanup-evidence category is independently satisfied).
 */
export async function terminateEc2Box(
  box: Ec2Box,
  options: { region: string; exec?: Ec2Exec; log?: (message: string) => void },
): Promise<void> {
  const exec = options.exec ?? defaultEc2Exec;
  const log = options.log ?? (() => undefined);
  log(`terminating instance ${box.instanceId}`);
  await exec.run(["ec2", "terminate-instances", "--region", options.region, "--instance-ids", box.instanceId]).catch(() => undefined);
  await exec.run(["ec2", "wait", "instance-terminated", "--region", options.region, "--instance-ids", box.instanceId]).catch(() => undefined);
  await deleteSecurityGroupById(exec, options.region, box.securityGroupId, log);
  await deleteKeyPair(exec, options.region, box.keyName, box.keyPath, log);
}

/**
 * Resolves this runner's public IPv4 for the `/32` SSH ingress rule. Uses the
 * injectable resolver so unit tests never touch the network; the default hits
 * the AWS `checkip` endpoint (matching `selfhost-box.sh`).
 */
export async function resolveRunnerPublicIp(options: { resolve?: PublicIpResolver } = {}): Promise<string> {
  const resolve = options.resolve ?? defaultPublicIpResolver;
  const ip = (await resolve()).trim();
  if (!IPV4_PATTERN.test(ip)) {
    throw new Error(`Could not resolve a valid public IPv4 for the SSH ingress rule (got "${ip}").`);
  }
  return ip;
}

export interface WaitForSshOptions {
  ssh: SshRunner;
  timeoutMs?: number;
  intervalMs?: number;
  log?: (message: string) => void;
}

/**
 * Bounded wait until SSH answers and cloud-init (docker install) has completed —
 * gated on the `selfhost-ready` marker the user-data drops plus a working
 * `docker compose`. Throws a bounded error on timeout.
 */
export async function waitForSshAndCloudInit(_box: Ec2Box, options: WaitForSshOptions): Promise<void> {
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? 8 * 60_000;
  const intervalMs = options.intervalMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      await options.ssh.run("test -f /var/lib/cloud/selfhost-ready && docker compose version", { timeoutMs: 20_000 });
      log(`SSH + cloud-init ready after ${attempts} probe(s)`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }
  throw new Error(`SSH / cloud-init did not become ready within ${timeoutMs}ms (last: ${lastError})`);
}

/** Deletes the run's key pair (idempotent) and removes the 0600 key file. */
async function deleteKeyPair(
  exec: Ec2Exec,
  region: string,
  keyName: string,
  keyPath: string,
  log: (message: string) => void,
): Promise<void> {
  log(`deleting key pair ${keyName}`);
  await exec.run(["ec2", "delete-key-pair", "--region", region, "--key-name", keyName]);
  await rm(keyPath, { force: true }).catch(() => undefined);
}

/**
 * Deletes a security group by its deterministic run-scoped name (default VPC),
 * retrying while the just-terminated instance's ENI detaches (DependencyViolation
 * lag). An already-absent group is treated as success (idempotent replay).
 */
async function deleteSecurityGroupByName(
  exec: Ec2Exec,
  region: string,
  groupName: string,
  log: (message: string) => void,
): Promise<void> {
  log(`deleting security group ${groupName}`);
  await deleteSecurityGroupWithRetry(exec, ["--group-name", groupName], region);
}

/** Deletes a security group by id (manual/recovery teardown from box coords). */
async function deleteSecurityGroupById(
  exec: Ec2Exec,
  region: string,
  groupId: string,
  log: (message: string) => void,
): Promise<void> {
  log(`deleting security group ${groupId}`);
  await deleteSecurityGroupWithRetry(exec, ["--group-id", groupId], region);
}

async function deleteSecurityGroupWithRetry(
  exec: Ec2Exec,
  selector: readonly string[],
  region: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await exec.run(["ec2", "delete-security-group", "--region", region, ...selector]);
      return;
    } catch (error) {
      if (isNotFound(error)) {
        return; // Already gone — a clean, idempotent outcome.
      }
      lastError = error;
      await sleep(5_000);
    }
  }
  throw new Error(
    `Could not delete security group after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Terminates every instance carrying the run-scoped Name tag (idempotent — no
 * matching instance is a clean outcome). Scoped by the unique tag so it can
 * never touch another run's box.
 */
async function terminateInstancesByNameTag(
  exec: Ec2Exec,
  region: string,
  nameTag: string,
  log: (message: string) => void,
): Promise<void> {
  const ids = (
    await exec.run([
      "ec2",
      "describe-instances",
      "--region",
      region,
      "--filters",
      `Name=tag:${INSTANCE_NAME_TAG},Values=${nameTag}`,
      "Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down",
      "--query",
      "Reservations[].Instances[].InstanceId",
      "--output",
      "text",
    ])
  )
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== "None");
  if (ids.length === 0) {
    return;
  }
  log(`terminating instance(s) ${ids.join(", ")} (tag ${INSTANCE_NAME_TAG}=${nameTag})`);
  await exec.run(["ec2", "terminate-instances", "--region", region, "--instance-ids", ...ids]);
  await exec.run(["ec2", "wait", "instance-terminated", "--region", region, "--instance-ids", ...ids]).catch(() => undefined);
}

/** Builds an `aws` `Tags=[{Key=..,Value=..}]` clause from a tag record. */
function tagSpec(tags: Record<string, string>): string {
  const entries = Object.entries(tags).map(([key, value]) => `{Key=${key},Value=${value}}`);
  const purpose = tags.Purpose ? "" : `{Key=Purpose,Value=${PURPOSE_TAG_VALUE}},`;
  return `Tags=[${purpose}${entries.join(",")}]`;
}

function amiArchForInstanceType(instanceType: string): "amd64" | "arm64" {
  // Graviton families end their size-prefix with a `g` (t4g, m7g, c7g, r7g, a1…).
  const family = instanceType.split(".")[0] ?? "";
  return /(?:^a1$)|g[a-z]*$/.test(family) ? "arm64" : "amd64";
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /InvalidGroup\.NotFound|does not exist|InvalidGroupId\.NotFound/i.test(message);
}

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const execFileAsync = promisify(execFile);

const defaultEc2Exec: Ec2Exec = {
  async run(args, options) {
    const { stdout } = await execFileAsync("aws", [...args], {
      timeout: options?.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.toString();
  },
};

const defaultPublicIpResolver: PublicIpResolver = async () => {
  const response = await fetch("https://checkip.amazonaws.com", { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`checkip.amazonaws.com returned HTTP ${response.status}`);
  }
  return (await response.text()).trim();
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
