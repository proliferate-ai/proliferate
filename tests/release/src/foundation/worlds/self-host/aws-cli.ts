/**
 * Thin, injectable wrapper around the `aws` CLI for the self-host world's
 * disposable EC2 capacity. Every function here takes an `ExecFn` as its
 * first argument so tests can fake the AWS/SSH boundary completely (no real
 * credentials, no real spend) while still exercising the provisioner's
 * ledger-ordering and readiness logic for real.
 *
 * Never touches `proliferate-prod*`: every resource created here is a
 * dedicated, clearly tagged (`Purpose=self-host-e2e`), throwaway key
 * pair/security group/instance in the default VPC, scoped to one run id.
 */

import { spawn } from "node:child_process";

export type ExecFn = (cmd: string, args: readonly string[], timeoutMs?: number) => Promise<string>;

export const realExec: ExecFn = (cmd, args, timeoutMs = 5 * 60_000) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
    });
  });

const aws = (exec: ExecFn, region: string, args: string[], timeoutMs?: number): Promise<string> =>
  exec("aws", ["--region", region, "--output", "json", ...args], timeoutMs);

export const RUN_TAG_KEY = "proliferate-selfhost-e2e-run";

export async function myPublicIp(exec: ExecFn): Promise<string> {
  const out = await exec("curl", ["-fsS", "https://checkip.amazonaws.com"], 15_000);
  return out.trim();
}

export async function resolveUbuntuAmi(exec: ExecFn, region: string, arch: "arm64" | "amd64"): Promise<string> {
  const out = await aws(exec, region, [
    "ssm",
    "get-parameters",
    "--names",
    `/aws/service/canonical/ubuntu/server/24.04/stable/current/${arch}/hvm/ebs-gp3/ami-id`,
  ]);
  const parsed = JSON.parse(out) as { Parameters: Array<{ Value: string }> };
  const ami = parsed.Parameters[0]?.Value;
  if (!ami) throw new Error(`resolveUbuntuAmi: no AMI resolved for ${arch} in ${region}`);
  return ami;
}

export async function createKeyPair(exec: ExecFn, region: string, keyName: string, runId: string): Promise<string> {
  const out = await aws(exec, region, [
    "ec2",
    "create-key-pair",
    "--key-name",
    keyName,
    "--tag-specifications",
    tagSpec("key-pair", runId),
    "--query",
    "KeyMaterial",
  ]);
  return JSON.parse(out) as string;
}

export async function deleteKeyPair(exec: ExecFn, region: string, keyName: string): Promise<void> {
  await aws(exec, region, ["ec2", "delete-key-pair", "--key-name", keyName]);
}

export async function createSecurityGroup(exec: ExecFn, region: string, name: string, runId: string): Promise<string> {
  const out = await aws(exec, region, [
    "ec2",
    "create-security-group",
    "--group-name",
    name,
    "--description",
    "Proliferate self-host e2e test (throwaway, run-scoped)",
    "--tag-specifications",
    tagSpec("security-group", runId),
    "--query",
    "GroupId",
  ]);
  return JSON.parse(out) as string;
}

export async function authorizeIngress(
  exec: ExecFn,
  region: string,
  sgId: string,
  sshSourceCidr: string,
): Promise<void> {
  await aws(exec, region, [
    "ec2",
    "authorize-security-group-ingress",
    "--group-id",
    sgId,
    "--ip-permissions",
    `IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]`,
    `IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]`,
    `IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${sshSourceCidr}}]`,
  ]);
}

export async function deleteSecurityGroup(exec: ExecFn, region: string, sgId: string): Promise<void> {
  await aws(exec, region, ["ec2", "delete-security-group", "--group-id", sgId]);
}

export interface RunInstanceParams {
  ami: string;
  instanceType: string;
  keyName: string;
  sgId: string;
  userDataFile: string;
  runId: string;
}

export async function runInstance(exec: ExecFn, region: string, params: RunInstanceParams): Promise<string> {
  const out = await aws(exec, region, [
    "ec2",
    "run-instances",
    "--image-id",
    params.ami,
    "--instance-type",
    params.instanceType,
    "--key-name",
    params.keyName,
    "--security-group-ids",
    params.sgId,
    "--block-device-mappings",
    "DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}",
    "--user-data",
    `file://${params.userDataFile}`,
    "--tag-specifications",
    tagSpec("instance", params.runId),
    "--query",
    "Instances[0].InstanceId",
  ]);
  return JSON.parse(out) as string;
}

export async function waitInstanceRunning(exec: ExecFn, region: string, instanceId: string): Promise<void> {
  await aws(exec, region, ["ec2", "wait", "instance-running", "--instance-ids", instanceId], 5 * 60_000);
}

export async function waitInstanceStatusOk(exec: ExecFn, region: string, instanceId: string): Promise<void> {
  await aws(exec, region, ["ec2", "wait", "instance-status-ok", "--instance-ids", instanceId], 5 * 60_000);
}

export async function publicIpOf(exec: ExecFn, region: string, instanceId: string): Promise<string> {
  const out = await aws(exec, region, [
    "ec2",
    "describe-instances",
    "--instance-ids",
    instanceId,
    "--query",
    "Reservations[0].Instances[0].PublicIpAddress",
  ]);
  const ip = JSON.parse(out) as string;
  if (!ip || ip === "None") throw new Error(`publicIpOf: instance ${instanceId} has no public IP`);
  return ip;
}

export async function terminateInstance(exec: ExecFn, region: string, instanceId: string): Promise<void> {
  await aws(exec, region, ["ec2", "terminate-instances", "--instance-ids", instanceId]);
}

export async function waitInstanceTerminated(exec: ExecFn, region: string, instanceId: string): Promise<void> {
  await aws(exec, region, ["ec2", "wait", "instance-terminated", "--instance-ids", instanceId], 5 * 60_000);
}

function tagSpec(resourceType: string, runId: string): string {
  // TTL tag lets an abandoned-run janitor find and reap this resource even if
  // this process never reaches its own teardown.
  return `ResourceType=${resourceType},Tags=[{Key=Purpose,Value=self-host-e2e},{Key=${RUN_TAG_KEY},Value=${runId}},{Key=Name,Value=selfhost-e2e-${runId}}]`;
}
