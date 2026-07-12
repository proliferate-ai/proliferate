/**
 * Self-hosting infrastructure fixture (specs/developing/testing/self-hosting.md
 * §6). Wraps tests/release/scripts/selfhost-box.sh so a scenario can provision
 * and tear down its own throwaway EC2 self-hosted control plane, and holds the
 * SSH + first-run-claim helpers the self-hosting scenarios share.
 *
 * The provisioning script boots the exact production compose bundle from this
 * checkout (server/deploy/**) on a stock Ubuntu box with a sslip.io hostname and
 * real Caddy-issued TLS — the same motion an operator runs, but self-contained
 * and self-terminating. Gated behind RELEASE_E2E_SELFHOST_PROVISION at the
 * scenario level (cost control); this module assumes the caller already checked
 * that and just does the work.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { redactSecrets } from "../report/redaction.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// src/fixtures -> up two to tests/release, then scripts/.
const SELFHOST_BOX_SCRIPT = resolve(HERE, "..", "..", "scripts", "selfhost-box.sh");

export interface SelfHostBox {
  instanceId: string;
  sgId: string;
  keyName: string;
  keyPath: string;
  publicIp: string;
  url: string;
  sshUser: string;
}

/**
 * Provisions a fresh self-hosted box pinned to `imageTag` and returns its
 * coordinates. The heavy lifting (AMI resolve, key pair + SG, run-instances,
 * bootstrap.sh over SSH, TLS health gate) lives in the shell script so the same
 * recipe is runnable by hand for a live proof. Progress streams to this
 * process's stderr; the script prints one JSON line to stdout, parsed here.
 */
export async function provisionSelfHostBox(imageTag: string): Promise<SelfHostBox> {
  const stdout = await runScript(
    ["provision", "--tag", imageTag],
    configuredMilliseconds("SELFHOST_BOX_PROVISION_TIMEOUT_MS", 20 * 60_000),
  );
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let parsed: SelfHostBox;
  try {
    parsed = JSON.parse(line) as SelfHostBox;
  } catch {
    throw new Error(`provisionSelfHostBox: could not parse box JSON from selfhost-box.sh: ${line}`);
  }
  return parsed;
}

/** Terminates the instance and deletes the throwaway SG + key pair. A failure
 * is part of qualification: callers aggregate it with any scenario error. */
export async function terminateSelfHostBox(box: SelfHostBox): Promise<void> {
  try {
    await runScript(
      [
        "terminate",
        "--instance-id",
        box.instanceId,
        "--sg-id",
        box.sgId,
        "--key-name",
        box.keyName,
        "--key-path",
        box.keyPath,
      ],
      configuredMilliseconds("SELFHOST_BOX_TERMINATE_TIMEOUT_MS", 10 * 60_000),
    );
  } catch (error) {
    throw new Error(
      `self-host cleanup failed for instance=${box.instanceId}, security-group=${box.sgId}, ` +
        `key-pair=${box.keyName}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Terminate manually: aws ec2 terminate-instances --instance-ids ${box.instanceId}`,
      { cause: error },
    );
  }
}

const SETUP_TOKEN_PATH = "/var/lib/proliferate/setup/setup-token";

/**
 * The compose invocation the deploy scripts use, run over SSH. Both
 * `PROLIFERATE_ENV_FILE` (env var) and `--env-file` are needed: the production
 * compose file resolves each service's secrets via
 * `env_file: ${PROLIFERATE_ENV_FILE:-.env}`, which docker compose reads from the
 * interpolation environment (not from `--env-file`), so `exec`/`run` against any
 * service fails with "env file .env not found" unless the var is exported.
 * bootstrap.sh/update.sh export it themselves; ad-hoc `exec` calls must set it.
 */
export const COMPOSE_OVER_SSH =
  "sudo PROLIFERATE_ENV_FILE=.env.runtime docker compose --env-file .env.runtime -f docker-compose.production.yml";

/**
 * Reads the first-run setup token from the api container over SSH — the same
 * token wait-for-health.sh prints, never served over HTTP. Present only while
 * the instance is unclaimed; returns "" once claimed.
 */
export async function readSetupTokenOverSsh(box: SelfHostBox): Promise<string> {
  const out = await ssh(
    box,
    `cd ~/proliferate/deploy && ${COMPOSE_OVER_SSH} exec -T api cat ${SETUP_TOKEN_PATH} 2>/dev/null || true`,
  );
  return out.trim();
}

/** Runs `update.sh` on the box (pull + migrate + restart) — the T4-SH-1 motion. */
export async function runUpdateOverSsh(box: SelfHostBox, imageTag: string): Promise<void> {
  // update.sh reads the image tag from .env.static; bump it there first, then
  // run the operator's exact updater.
  await ssh(
    box,
    `cd ~/proliferate/deploy && ` +
      `sudo sed -i 's|^PROLIFERATE_SERVER_IMAGE_TAG=.*|PROLIFERATE_SERVER_IMAGE_TAG=${imageTag}|' .env.static && ` +
      `sudo ./update.sh`,
  );
}

/** Arbitrary command over SSH on the box; throws on non-zero exit. */
export async function ssh(box: SelfHostBox, command: string): Promise<string> {
  return runCommand(
    "ssh",
    [
      "-i",
      box.keyPath,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ConnectTimeout=15",
      `${box.sshUser}@${box.publicIp}`,
      command,
    ],
    5 * 60_000,
  );
}

function runScript(args: string[], timeoutMs: number): Promise<string> {
  return runCommand("bash", [SELFHOST_BOX_SCRIPT, ...args], timeoutMs, {
    inheritStderr: true,
    // EC2's termination waiter can legitimately take ten minutes. Preserve a
    // bounded window large enough for waiter + SG detach retries before KILL.
    terminationGraceMs: configuredMilliseconds(
      "SELFHOST_BOX_TERMINATION_GRACE_MS",
      12 * 60_000,
    ),
  });
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
  options: { inheritStderr?: boolean; terminationGraceMs?: number } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const terminationGraceMs = options.terminationGraceMs ?? 5_000;
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let requiredSigkill = false;
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    let hardStopTimer: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };
    const resolveOnce = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolvePromise(value);
    };
    const timeoutError = () =>
      new Error(
        `${cmd} ${args[0]} timed out after ${timeoutMs / 1000}s; ` +
          (requiredSigkill
            ? `SIGTERM cleanup grace (${terminationGraceMs / 1000}s) expired and SIGKILL was required`
            : `process exited during the ${terminationGraceMs / 1000}s SIGTERM cleanup grace`) +
          (stderr ? `: ${stderr.trim()}` : ""),
      );

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      const safeChunk = redactSecrets(chunk.toString());
      stderr += safeChunk;
      if (options.inheritStderr) {
        process.stderr.write(safeChunk);
      }
    });
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child.pid, child, "SIGTERM");
      graceTimer = setTimeout(() => {
        requiredSigkill = true;
        signalProcessGroup(child.pid, child, "SIGKILL");
        // SIGKILL should close the process group immediately. Keep the Promise
        // bounded even if a platform fails to deliver a close event.
        hardStopTimer = setTimeout(() => rejectOnce(timeoutError()), 5_000);
      }, terminationGraceMs);
    }, timeoutMs);
    child.on("error", (error) => {
      rejectOnce(error);
    });
    child.on("close", (code) => {
      if (timedOut) {
        rejectOnce(timeoutError());
        return;
      }
      if (code === 0) {
        resolveOnce(stdout);
      } else {
        rejectOnce(new Error(`${cmd} ${args[0]} exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}

function signalProcessGroup(
  pid: number | undefined,
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  try {
    if (process.platform !== "win32" && pid) {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    // Fall back to the leader on platforms/sandboxes that reject negative-pid
    // delivery. The grace timer still owns the bounded KILL escalation.
    try {
      child.kill(signal);
    } catch {
      // The close event or hard-stop timer settles the command.
    }
  }
}

function configuredMilliseconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds`);
  }
  return value;
}
