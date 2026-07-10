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
  const stdout = await runScript(["provision", "--tag", imageTag], 20 * 60_000);
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let parsed: SelfHostBox;
  try {
    parsed = JSON.parse(line) as SelfHostBox;
  } catch {
    throw new Error(`provisionSelfHostBox: could not parse box JSON from selfhost-box.sh: ${line}`);
  }
  return parsed;
}

/** Terminates the instance and deletes the throwaway SG + key pair. Best-effort. */
export async function terminateSelfHostBox(box: SelfHostBox): Promise<void> {
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
    10 * 60_000,
  ).catch((error) => {
    // A teardown failure must be loud (it leaks a box) but must not mask a real
    // scenario result — callers run this in a finally.
    console.error(
      `[selfhost] WARNING: teardown of ${box.instanceId} failed: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Terminate it manually: aws ec2 terminate-instances --instance-ids ${box.instanceId}`,
    );
  });
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
  return runCommand("bash", [SELFHOST_BOX_SCRIPT, ...args], timeoutMs, { inheritStderr: true });
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
  options: { inheritStderr?: boolean } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", options.inheritStderr ? "inherit" : "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} ${args[0]} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(`${cmd} ${args[0]} exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}
