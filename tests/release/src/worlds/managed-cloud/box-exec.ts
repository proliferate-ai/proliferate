import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { REMOTE_WORKDIR, type SshExec } from "./ingress.js";

/**
 * A minimal server-side exec seam on the candidate box (spec "World
 * construction": the run-scoped EC2 box holds the candidate Server + its DB).
 * Both the Core-funding entitlement seed (gap 3) and the GitHub-authorization
 * seed (gap 4) need to run the product's OWN store/service functions against
 * the candidate box's Postgres — there is no public endpoint for either — so
 * this wraps the same injectable `SshExec` the world already uses into three
 * capabilities:
 *
 *   - `exec(command)`      — a raw SSH command on the box (fake in unit tests);
 *   - `putSecretFile(...)` — stage a mode-0600 file under `REMOTE_WORKDIR`
 *                            (bind-mounted into the `candidate-server`
 *                            container), so secret VALUES travel as a copied
 *                            file, never as an SSH/`docker exec` argv;
 *   - `serverPython(...)`  — run a Python snippet INSIDE the `candidate-server`
 *                            container, against the server's own modules
 *                            (`proliferate.*`) and DB session factory.
 *
 * Every side effect is behind the injected `SshExec`, so this module's unit
 * tests exercise the exact argv/file plumbing offline with a fake SSH seam and
 * no real box, network, docker, or secret material.
 */

/** The container the candidate Server (and its Python env + DB access) runs in. */
export const CANDIDATE_SERVER_CONTAINER = "candidate-server";

export interface BoxExecDeps {
  ssh: SshExec;
  /** SSH destination, e.g. `ubuntu@<ip>`. */
  destination: string;
  /** Path to the run-owned key file. */
  keyPath: string;
  /** Local mode-0700 dir where secret files are staged before `scp`. */
  secretsDir: string;
  /** Remote workspace root, bind-mounted into the server container. */
  remoteWorkdir?: string;
  log?: (message: string) => void;
}

export interface ServerPythonOptions {
  /**
   * Non-secret environment variables (paths, ids) exported for the snippet via
   * `docker exec -e`. Secret VALUES must NOT be passed here — stage them with
   * `putSecretFile` and read the file inside the snippet.
   */
  env?: Record<string, string>;
  /** Stable basename for the staged script (defaults to a unique name). */
  scriptName?: string;
}

export interface BoxExec {
  exec(command: string): Promise<{ stdout: string; stderr: string }>;
  /**
   * Stages `contents` as a mode-0600 file under `REMOTE_WORKDIR/<remoteName>`
   * and returns its absolute remote path. The value never appears in an argv.
   */
  putSecretFile(remoteName: string, contents: string): Promise<string>;
  /** Reads a remote file's contents over the SSH channel (never logged). */
  readRemoteFile(remotePath: string): Promise<string>;
  /** Removes a remote file (best-effort; used to shred staged secret files). */
  removeRemoteFile(remotePath: string): Promise<void>;
  /**
   * Runs `script` with `python` inside the `candidate-server` container and
   * returns its stdout/stderr. The script is staged under `REMOTE_WORKDIR`
   * (mounted into the container) and executed by path — never inlined into the
   * shell argv, so quoting is never a hazard.
   */
  serverPython(script: string, options?: ServerPythonOptions): Promise<{ stdout: string; stderr: string }>;
}

/** Escapes a value for safe single-quoted POSIX shell interpolation. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createBoxExec(deps: BoxExecDeps): BoxExec {
  const remoteWorkdir = deps.remoteWorkdir ?? REMOTE_WORKDIR;
  const log = deps.log ?? (() => undefined);
  let counter = 0;

  const exec: BoxExec["exec"] = (command) => deps.ssh.run(deps.destination, deps.keyPath, command);

  const putSecretFile: BoxExec["putSecretFile"] = async (remoteName, contents) => {
    await mkdir(deps.secretsDir, { recursive: true, mode: 0o700 });
    const localPath = path.join(deps.secretsDir, `box-${remoteName}`);
    await writeFile(localPath, contents, { mode: 0o600 });
    const remotePath = `${remoteWorkdir}/${remoteName}`;
    await deps.ssh.copyFile(deps.destination, deps.keyPath, localPath, remotePath);
    // The staged local copy is no longer needed; drop it so the secret does not
    // linger on the runner outside the run-scoped secrets dir (which world
    // cleanup removes anyway).
    await rm(localPath, { force: true }).catch(() => undefined);
    return remotePath;
  };

  const readRemoteFile: BoxExec["readRemoteFile"] = async (remotePath) => {
    const { stdout } = await exec(`cat ${shellSingleQuote(remotePath)}`);
    return stdout;
  };

  const removeRemoteFile: BoxExec["removeRemoteFile"] = async (remotePath) => {
    await exec(`rm -f ${shellSingleQuote(remotePath)}`).catch(() => undefined);
  };

  const serverPython: BoxExec["serverPython"] = async (script, options) => {
    counter += 1;
    const scriptName = options?.scriptName ?? `seed-${Date.now()}-${counter}.py`;
    const remoteScriptPath = await putSecretFile(scriptName, script);
    const envFlags = Object.entries(options?.env ?? {})
      .map(([key, value]) => `-e ${shellSingleQuote(`${key}=${value}`)}`)
      .join(" ");
    // Prefer `python` (the venv on PATH) and fall back to `python3`; single
    // exec, so a real error never silently re-runs a non-idempotent snippet.
    const inner = `command -v python >/dev/null 2>&1 && P=python || P=python3; exec "$P" ${shellSingleQuote(remoteScriptPath)}`;
    const command =
      `sudo docker exec ${envFlags} ${CANDIDATE_SERVER_CONTAINER} sh -c ${shellSingleQuote(inner)}`;
    log(`box: docker exec ${CANDIDATE_SERVER_CONTAINER} python ${scriptName}`);
    try {
      return await exec(command);
    } finally {
      await removeRemoteFile(remoteScriptPath);
    }
  };

  return { exec, putSecretFile, readRemoteFile, removeRemoteFile, serverPython };
}
