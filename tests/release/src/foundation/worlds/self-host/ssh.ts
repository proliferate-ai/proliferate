/**
 * SSH/SCP helpers against a disposable self-host EC2 box, built on the same
 * injectable `ExecFn` convention as `aws-cli.ts` so tests can fake the
 * transport completely.
 */

import type { ExecFn } from "./aws-cli.js";

export interface SshTarget {
  readonly keyPath: string;
  readonly sshUser: string;
  readonly publicIp: string;
}

function sshBaseArgs(target: SshTarget): string[] {
  return [
    "-i",
    target.keyPath,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ConnectTimeout=15",
  ];
}

export async function sshExec(
  exec: ExecFn,
  target: SshTarget,
  command: string,
  timeoutMs = 5 * 60_000,
): Promise<string> {
  return exec("ssh", [...sshBaseArgs(target), `${target.sshUser}@${target.publicIp}`, command], timeoutMs);
}

/** Non-throwing probe: never throws on a non-zero remote exit, returns the raw stdout/marker instead. */
export async function sshProbe(
  exec: ExecFn,
  target: SshTarget,
  command: string,
  timeoutMs = 30_000,
): Promise<string> {
  try {
    return await sshExec(exec, target, command, timeoutMs);
  } catch {
    return "";
  }
}

export async function scpUpload(
  exec: ExecFn,
  target: SshTarget,
  localPath: string,
  remotePath: string,
  timeoutMs = 5 * 60_000,
): Promise<void> {
  await exec(
    "scp",
    [...sshBaseArgs(target), localPath, `${target.sshUser}@${target.publicIp}:${remotePath}`],
    timeoutMs,
  );
}

/** Copies a local directory up as a gzipped tar, extracted at `remoteDestDir` on the box. */
export async function scpUploadDirAsTar(
  exec: ExecFn,
  target: SshTarget,
  localTarPath: string,
  remoteDestDir: string,
  timeoutMs = 5 * 60_000,
): Promise<void> {
  await scpUpload(exec, target, localTarPath, "/tmp/upload.tar.gz", timeoutMs);
  await sshExec(
    exec,
    target,
    `mkdir -p ${remoteDestDir} && tar -C ${remoteDestDir} -xzf /tmp/upload.tar.gz && rm -f /tmp/upload.tar.gz`,
    timeoutMs,
  );
}
