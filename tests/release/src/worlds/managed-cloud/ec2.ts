import { chmod, writeFile } from "node:fs/promises";

/**
 * The run-scoped EC2 + security-group + key-pair + Route53 provisioner (spec
 * "Ingress decision: run-scoped EC2 + Caddy + Route53 A record"). It reuses the
 * proven self-host box pattern (`tests/release/scripts/selfhost-box.sh`,
 * `server/infra/self-hosted-aws/template.yaml`): every resource is discrete,
 * taggable, registered-before-create in the cleanup ledger, and reconciled in
 * reverse order.
 *
 * This module owns ONLY the raw AWS resource lifecycle (instance, security
 * group, key pair, Route53 A record) behind an injectable seam. Deploying the
 * candidate Server + Caddy TLS onto the box and producing the
 * `candidate-api/<subdomain>` receipt is `ingress.ts`'s job.
 *
 * HARD RULES honored by the contract:
 *   - AWS credentials come from the ambient environment (the `aws` CLI), never
 *     argv and never a repo variable — matching RELEASE_E2E_SELFHOST_PROVISION.
 *   - Every resource is tagged with the qualification run identity so a sweep
 *     can find orphans; nothing ever touches `proliferate-prod*`.
 *   - `assertNotProduction`-style guarding stays on every mutating call.
 */

/** The typed AWS inputs (no secret VALUES — creds are ambient). */
export interface Ec2ProvisionConfig {
  /** AWS region hosting the qualification ingress boxes. */
  region: string;
  /** Route53 hosted-zone id for `qualification.proliferate.com`. */
  hostedZoneId: string;
  /** The zone apex the run subdomain is created under. */
  zoneName: string;
  /** EC2 instance type (e.g. `t3.small`, matching the self-host box). */
  instanceType: string;
  /** AMI id (stock Ubuntu) or an SSM parameter reference resolved by the impl. */
  imageRef: string;
}

/** Run-scoped tags every created resource carries (safe identifiers only). */
export interface Ec2ResourceTags {
  purpose: "managed-cloud-qualification";
  runId: string;
  shardId: string;
}

/** The run subdomain + its Route53 A record identity. */
export interface Route53Record {
  /** `<run>.qualification.proliferate.com`. */
  recordName: string;
  hostedZoneId: string;
  /** IPv4 the A record points at (the box's public IP). */
  address: string;
  /** TTL seconds (spec: 60). */
  ttl: number;
}

/**
 * The provisioned ingress box. `keyPath` is the mode-0600 private-key file the
 * impl writes locally (the file is the secret; only its PATH is carried here —
 * never the key material).
 */
export interface Ec2IngressBox {
  instanceId: string;
  securityGroupId: string;
  keyName: string;
  keyPath: string;
  publicIp: string;
  /** SSH destination, e.g. `ubuntu@<ip>`. */
  sshDestination: string;
}

/** The four raw AWS resource kinds this module registers for cleanup. */
export type Ec2CleanupKind = "ec2_instance" | "security_group" | "key_pair" | "route53_record";

/**
 * Injectable command seam — the default impl shells to `aws` / `curl` with
 * `execFile` (no shell, so argv is never word-split) and ambient credentials.
 * Unit tests pass a fake so no real AWS call, network, or spend happens offline.
 */
export type AwsCliExec = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * The injectable AWS seam. The default impl (`AwsCliEc2Provisioner`) shells to
 * `aws ec2` / `aws route53` exactly like `selfhost-box.sh`; unit tests pass a
 * fake so no real AWS call, network, or spend happens offline.
 *
 * Every method that creates a resource is called AFTER its cleanup-ledger
 * intent is written by the world constructor, and returns the safe provider id
 * the world records with `acquired(...)`.
 */
export interface Ec2Provisioner {
  createKeyPair(config: Ec2ProvisionConfig, tags: Ec2ResourceTags, keyName: string, keyPath: string): Promise<void>;
  deleteKeyPair(config: Ec2ProvisionConfig, keyName: string): Promise<void>;
  createSecurityGroup(config: Ec2ProvisionConfig, tags: Ec2ResourceTags, groupName: string): Promise<string>;
  authorizeIngress(config: Ec2ProvisionConfig, securityGroupId: string): Promise<void>;
  deleteSecurityGroup(config: Ec2ProvisionConfig, securityGroupId: string): Promise<void>;
  runInstance(
    config: Ec2ProvisionConfig,
    tags: Ec2ResourceTags,
    params: { securityGroupId: string; keyName: string; userData?: string },
  ): Promise<string>;
  waitInstanceRunning(config: Ec2ProvisionConfig, instanceId: string): Promise<string>;
  waitStatusOk(config: Ec2ProvisionConfig, instanceId: string): Promise<void>;
  terminateInstance(config: Ec2ProvisionConfig, instanceId: string): Promise<void>;
  upsertARecord(config: Ec2ProvisionConfig, record: Route53Record): Promise<void>;
  deleteARecord(config: Ec2ProvisionConfig, record: Route53Record): Promise<void>;
}

/**
 * The cloud-init the ingress instance boots with: install docker (so
 * `ingress.ts` can `docker load` the exact Server image over SSH) and drop a
 * readiness sentinel the deploy step waits for. Caddy + the candidate Server
 * are configured over SSH by `ingress.ts`, not here.
 */
export const INGRESS_BOOTSTRAP_USER_DATA = `#!/bin/bash
set -eux
export DEBIAN_FRONTEND=noninteractive
for i in $(seq 1 30); do apt-get update && break || sleep 5; done
apt-get install -y docker.io curl ca-certificates
systemctl enable --now docker
usermod -aG docker ubuntu
touch /var/lib/cloud/ingress-ready
`;

/**
 * Everything `provisionRunIngress` needs. The two-phase ledger registrar makes
 * every AWS resource registered-before-create: `register` writes the `intent`
 * record and returns the entry id BEFORE the create call, and `acquired`
 * attaches the safe provider id once creation returns — so a crash between the
 * create call and the record never orphans an untracked resource.
 */
export interface ProvisionRunIngressOptions {
  config: Ec2ProvisionConfig;
  tags: Ec2ResourceTags;
  /** `<run>.qualification.proliferate.com`. */
  subdomain: string;
  provisioner: Ec2Provisioner;
  /** Writes the `intent` ledger record for a resource BEFORE it is created. */
  register: (kind: Ec2CleanupKind, release: () => Promise<void>) => Promise<string>;
  /** Attaches the safe provider id once the resource has been created. */
  acquired: (entryId: string, providerId: string) => Promise<void>;
  /** Where the mode-0600 key file is written under the run directory. */
  keyPath: string;
  /** Cloud-init the instance boots with (defaults to `INGRESS_BOOTSTRAP_USER_DATA`). */
  userData?: string;
  timeoutMs?: number;
  log?: (message: string) => void;
}

/**
 * Provisions the run-scoped ingress: key pair → security group (+ ingress
 * rules) → instance → wait running/status-ok → Route53 A record. Each resource
 * is registered in the cleanup ledger BEFORE it is created. Returns the box +
 * its A record for `ingress.ts` to deploy onto.
 */
export async function provisionRunIngress(options: ProvisionRunIngressOptions): Promise<{
  box: Ec2IngressBox;
  record: Route53Record;
}> {
  const { config, tags, provisioner, register, acquired, keyPath } = options;
  const log = options.log ?? (() => undefined);

  const keyName = ec2ResourceName("key", tags);
  const groupName = ec2ResourceName("sg", tags);
  assertNotProduction(keyName, groupName, tags.runId, options.subdomain, config.hostedZoneId);

  // Key pair (registered-before-create). The private key material lands only in
  // the mode-0600 `keyPath` file; the ledger carries the safe key NAME.
  log(`creating key pair ${keyName}`);
  const keyEntry = await register("key_pair", () => provisioner.deleteKeyPair(config, keyName));
  await provisioner.createKeyPair(config, tags, keyName, keyPath);
  await acquired(keyEntry, keyName);

  // Security group. The release closure reads `securityGroupId` by reference so
  // the intent can be written before the id exists.
  let securityGroupId = "";
  log(`creating security group ${groupName}`);
  const sgEntry = await register("security_group", () => provisioner.deleteSecurityGroup(config, securityGroupId));
  securityGroupId = await provisioner.createSecurityGroup(config, tags, groupName);
  await provisioner.authorizeIngress(config, securityGroupId);
  await acquired(sgEntry, securityGroupId);

  // Instance.
  let instanceId = "";
  log(`launching ${config.instanceType} instance`);
  const instanceEntry = await register("ec2_instance", () => provisioner.terminateInstance(config, instanceId));
  instanceId = await provisioner.runInstance(config, tags, {
    securityGroupId,
    keyName,
    userData: options.userData ?? INGRESS_BOOTSTRAP_USER_DATA,
  });
  await acquired(instanceEntry, instanceId);

  const publicIp = await provisioner.waitInstanceRunning(config, instanceId);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(publicIp)) {
    throw new Error(`Instance ${instanceId} reported no usable public IPv4 (got "${publicIp}").`);
  }
  await provisioner.waitStatusOk(config, instanceId);

  // Route53 A record (TTL 60) fronting the box's public IP.
  const record: Route53Record = {
    recordName: options.subdomain,
    hostedZoneId: config.hostedZoneId,
    address: publicIp,
    ttl: 60,
  };
  log(`upserting A record ${record.recordName} -> ${publicIp}`);
  const dnsEntry = await register("route53_record", () => provisioner.deleteARecord(config, record));
  await provisioner.upsertARecord(config, record);
  await acquired(dnsEntry, record.recordName);

  return {
    box: {
      instanceId,
      securityGroupId,
      keyName,
      keyPath,
      publicIp,
      sshDestination: `ubuntu@${publicIp}`,
    },
    record,
  };
}

/** Derives a run-scoped, AWS-safe resource name (lowercase, `[a-z0-9-]`). */
function ec2ResourceName(suffix: string, tags: Ec2ResourceTags): string {
  return `mcq-${tags.runId}-${tags.shardId}-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);
}

/** Fail-closed guard: never operate on a production-looking resource. */
function assertNotProduction(...identifiers: string[]): void {
  for (const identifier of identifiers) {
    if (identifier && /proliferate-prod/i.test(identifier)) {
      throw new Error(`Refusing to operate on a production-looking resource "${identifier}".`);
    }
  }
}

/** `ResourceType=<type>,Tags=[...]` for `aws ... --tag-specifications`. */
function tagSpecification(resourceType: string, tags: Ec2ResourceTags): string {
  const pairs = [
    `{Key=Purpose,Value=${tags.purpose}}`,
    `{Key=RunId,Value=${tags.runId}}`,
    `{Key=ShardId,Value=${tags.shardId}}`,
  ].join(",");
  return `ResourceType=${resourceType},Tags=[${pairs}]`;
}

function changeBatch(action: "UPSERT" | "DELETE", record: Route53Record): string {
  return JSON.stringify({
    Changes: [
      {
        Action: action,
        ResourceRecordSet: {
          Name: record.recordName,
          Type: "A",
          TTL: record.ttl,
          ResourceRecords: [{ Value: record.address }],
        },
      },
    ],
  });
}

/**
 * Default `aws` CLI provisioner. Every call shells to `aws ec2` / `aws route53`
 * with ambient credentials (never argv), mirroring `selfhost-box.sh`.
 */
export class AwsCliEc2Provisioner implements Ec2Provisioner {
  private readonly exec: AwsCliExec;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly deleteRetries: number;
  private readonly deleteRetryDelayMs: number;

  constructor(options: {
    exec?: AwsCliExec;
    sleep?: (ms: number) => Promise<void>;
    /** Bounded retries for the SG delete (ENI detach can lag termination). */
    deleteRetries?: number;
    deleteRetryDelayMs?: number;
  } = {}) {
    this.exec = options.exec ?? defaultAwsExec;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.deleteRetries = options.deleteRetries ?? 12;
    this.deleteRetryDelayMs = options.deleteRetryDelayMs ?? 5_000;
  }

  async createKeyPair(
    config: Ec2ProvisionConfig,
    tags: Ec2ResourceTags,
    keyName: string,
    keyPath: string,
  ): Promise<void> {
    assertNotProduction(keyName);
    const { stdout } = await this.exec("aws", [
      "ec2",
      "create-key-pair",
      "--region",
      config.region,
      "--key-name",
      keyName,
      "--tag-specifications",
      tagSpecification("key-pair", tags),
      "--query",
      "KeyMaterial",
      "--output",
      "text",
    ]);
    // The key material is the secret: it goes straight to a mode-0600 file and
    // is never returned, logged, or placed in argv.
    await writeFile(keyPath, stdout.endsWith("\n") ? stdout : `${stdout}\n`, { mode: 0o600 });
    await chmod(keyPath, 0o600);
  }

  async deleteKeyPair(config: Ec2ProvisionConfig, keyName: string): Promise<void> {
    assertNotProduction(keyName);
    await this.exec("aws", ["ec2", "delete-key-pair", "--region", config.region, "--key-name", keyName]);
  }

  async createSecurityGroup(config: Ec2ProvisionConfig, tags: Ec2ResourceTags, groupName: string): Promise<string> {
    assertNotProduction(groupName);
    const { stdout } = await this.exec("aws", [
      "ec2",
      "create-security-group",
      "--region",
      config.region,
      "--group-name",
      groupName,
      "--description",
      "Proliferate managed-cloud qualification ingress (throwaway)",
      "--tag-specifications",
      tagSpecification("security-group", tags),
      "--query",
      "GroupId",
      "--output",
      "text",
    ]);
    return stdout.trim();
  }

  async authorizeIngress(config: Ec2ProvisionConfig, securityGroupId: string): Promise<void> {
    assertNotProduction(securityGroupId);
    // Public 80/443 for Caddy TLS; SSH restricted to this runner's own address
    // (fail closed rather than open 22 to the world if the IP can't be resolved).
    const { stdout } = await this.exec("curl", ["-fsS", "https://checkip.amazonaws.com"]);
    const runnerIp = stdout.trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(runnerIp)) {
      throw new Error(`Could not resolve this runner's public IPv4 for the SSH ingress rule (got "${runnerIp}").`);
    }
    await this.exec("aws", [
      "ec2",
      "authorize-security-group-ingress",
      "--region",
      config.region,
      "--group-id",
      securityGroupId,
      "--ip-permissions",
      "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]",
      "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]",
      `IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${runnerIp}/32}]`,
    ]);
  }

  async deleteSecurityGroup(config: Ec2ProvisionConfig, securityGroupId: string): Promise<void> {
    assertNotProduction(securityGroupId);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.deleteRetries; attempt += 1) {
      try {
        await this.exec("aws", [
          "ec2",
          "delete-security-group",
          "--region",
          config.region,
          "--group-id",
          securityGroupId,
        ]);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.deleteRetries - 1) {
          await this.sleep(this.deleteRetryDelayMs);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async runInstance(
    config: Ec2ProvisionConfig,
    tags: Ec2ResourceTags,
    params: { securityGroupId: string; keyName: string; userData?: string },
  ): Promise<string> {
    assertNotProduction(params.keyName, params.securityGroupId, tags.runId);
    const imageId = await this.resolveImageId(config);
    const args = [
      "ec2",
      "run-instances",
      "--region",
      config.region,
      "--image-id",
      imageId,
      "--instance-type",
      config.instanceType,
      "--key-name",
      params.keyName,
      "--security-group-ids",
      params.securityGroupId,
      "--block-device-mappings",
      "DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}",
      "--tag-specifications",
      tagSpecification("instance", tags),
      "--query",
      "Instances[0].InstanceId",
      "--output",
      "text",
    ];
    if (params.userData) {
      // The AWS CLI base64-encodes a plain `--user-data` string for run-instances;
      // `execFile` passes it as a single argv element (no shell word-splitting).
      args.push("--user-data", params.userData);
    }
    const { stdout } = await this.exec("aws", args);
    return stdout.trim();
  }

  async waitInstanceRunning(config: Ec2ProvisionConfig, instanceId: string): Promise<string> {
    assertNotProduction(instanceId);
    await this.exec("aws", [
      "ec2",
      "wait",
      "instance-running",
      "--region",
      config.region,
      "--instance-ids",
      instanceId,
    ]);
    const { stdout } = await this.exec("aws", [
      "ec2",
      "describe-instances",
      "--region",
      config.region,
      "--instance-ids",
      instanceId,
      "--query",
      "Reservations[0].Instances[0].PublicIpAddress",
      "--output",
      "text",
    ]);
    return stdout.trim();
  }

  async waitStatusOk(config: Ec2ProvisionConfig, instanceId: string): Promise<void> {
    assertNotProduction(instanceId);
    await this.exec("aws", [
      "ec2",
      "wait",
      "instance-status-ok",
      "--region",
      config.region,
      "--instance-ids",
      instanceId,
    ]);
  }

  async terminateInstance(config: Ec2ProvisionConfig, instanceId: string): Promise<void> {
    assertNotProduction(instanceId);
    await this.exec("aws", [
      "ec2",
      "terminate-instances",
      "--region",
      config.region,
      "--instance-ids",
      instanceId,
    ]);
    // Best-effort settle so the SG delete that follows can succeed.
    await this.exec("aws", [
      "ec2",
      "wait",
      "instance-terminated",
      "--region",
      config.region,
      "--instance-ids",
      instanceId,
    ]).catch(() => undefined);
  }

  async upsertARecord(config: Ec2ProvisionConfig, record: Route53Record): Promise<void> {
    assertNotProduction(record.recordName);
    await this.exec("aws", [
      "route53",
      "change-resource-record-sets",
      "--hosted-zone-id",
      record.hostedZoneId,
      "--change-batch",
      changeBatch("UPSERT", record),
    ]);
  }

  async deleteARecord(config: Ec2ProvisionConfig, record: Route53Record): Promise<void> {
    assertNotProduction(record.recordName);
    await this.exec("aws", [
      "route53",
      "change-resource-record-sets",
      "--hosted-zone-id",
      record.hostedZoneId,
      "--change-batch",
      changeBatch("DELETE", record),
    ]);
  }

  /** An `ami-*` `imageRef` is used directly; anything else is an SSM parameter. */
  private async resolveImageId(config: Ec2ProvisionConfig): Promise<string> {
    if (config.imageRef.startsWith("ami-")) {
      return config.imageRef;
    }
    const { stdout } = await this.exec("aws", [
      "ssm",
      "get-parameters",
      "--region",
      config.region,
      "--names",
      config.imageRef,
      "--query",
      "Parameters[0].Value",
      "--output",
      "text",
    ]);
    const imageId = stdout.trim();
    if (!imageId.startsWith("ami-")) {
      throw new Error(`SSM parameter "${config.imageRef}" did not resolve to an AMI id (got "${imageId}").`);
    }
    return imageId;
  }
}

const defaultAwsExec: AwsCliExec = async (file, args, options) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout, stderr } = await run(file, [...args], {
    timeout: options?.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};
