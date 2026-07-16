import {
  execInProviderSandbox,
  killProviderSandbox,
  pauseProviderSandbox,
} from "./e2b-verify.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

/**
 * `injectFailureAt` — the failure-injection seams for CLOUD-PROVISION-RECOVERY-1's
 * five accepted-work boundaries (spec "New fixture obligations"; PR 6 fixture 3).
 *
 * VERIFIED against the candidate Server + runtime: there is NO env-flag / test
 * hook in the product that would let the server fail its own accepted work on
 * command. So injection is PROVIDER-SIDE and PROCESS-LEVEL only — kill the
 * provider sandbox, kill an in-sandbox process, or restart an on-box container —
 * at exactly the boundary the recovery journey names. Recovery is ALWAYS driven
 * back through the NORMAL product path (`POST /v1/cloud/cloud-sandbox/ensure`,
 * workspace open); this fixture never reaches inside product code to "un-fail".
 *
 * The injection PROVES the boundary rather than assuming it, and does so by
 * EXACT executable identity — never `pgrep -f`/`pkill -f`, whose whole-command-
 * line match would match the enumerator's own `sh -c` wrapper (the pattern is in
 * that command line) and could kill the controller shell or falsely prove the
 * target. Instead it enumerates PIDs whose `/proc/<pid>/exe` basename equals the
 * exact FULL executable name (`proliferate-worker`, `anyharness`, `git`) — NOT
 * `/proc/<pid>/comm`, which Linux truncates to 15 bytes (so `proliferate-worker`,
 * 18 chars, would never match). The exe basename is untruncated and inherently
 * excludes shell wrappers (exe = `sh`/`bash`); a fallback (truncated comm +
 * argv[0] basename) covers the rare unreadable-exe case. It excludes its own pid
 * + parent, kills that explicit PID list with SIGKILL, and verifies absence with
 * `kill -0` per pid. A MISSING target throws (never fabricates a success);
 * `injected` is true ONLY on a proven before-present + after-absent. No `|| true`
 * masks the real command exit.
 *
 * The five boundaries → their injection:
 *   - provider_create     — kill the provider sandbox right after it appears, so
 *                           it dies before Worker enrollment (proven by the
 *                           provider's own kill acknowledgement).
 *   - worker_enrollment   — SIGKILL `proliferate-worker` inside the sandbox
 *                           before its first heartbeat (proven present→absent).
 *   - runtime_readiness   — SIGKILL `anyharness` inside the sandbox before
 *                           readiness flips (proven present→absent).
 *   - repo_materialization— SIGKILL the IN-FLIGHT `git` clone/fetch INSIDE the
 *                           sandbox (bounded pgrep window), leaving the partial
 *                           checkout in place — the sandbox is NOT destroyed, so
 *                           this exercises partial-materialization recovery, not
 *                           reprovisioning. If no git process is observed in the
 *                           window it THROWS (never falls back to a sandbox kill).
 *   - workspace_creation  — restart the on-box `candidate-server` container
 *                           between the accepted create and its commit tail.
 *
 * Returns a `FailureInjectionHandle` whose `disarm()` is idempotent and MUST be
 * called in a `finally` — for the process/container boundaries it is a no-op
 * marker (the kill already happened; recovery re-drives the product), and it is
 * always safe to call more than once.
 *
 * Every side-effecting step is behind injectable seams (`FailureInjectionSeams`,
 * defaulting to the e2b-verify provider seams + an on-box container restart), so
 * unit tests exercise the exact injection wiring offline with no real sandbox,
 * box, or provider. No new cleanup kinds and no new env vars: the sandbox is
 * already registered under `e2b_sandbox` by the scenario, and killing it is that
 * releaser's job.
 */

export type FailureBoundary =
  | "provider_create"
  | "worker_enrollment"
  | "runtime_readiness"
  | "repo_materialization"
  | "workspace_creation";

/** What the injection acts on, resolved by the scenario at the boundary. */
export interface FailureInjectionTarget {
  /** The provider (E2B) sandbox id — required for every boundary except workspace_creation. */
  providerSandboxId?: string;
  /**
   * repo_materialization only: how long to poll for an in-flight `git`
   * clone/fetch before giving up (default 30s). If none appears in the window
   * the injection THROWS rather than falling back to destroying the sandbox.
   */
  gitWaitMs?: number;
  /** repo_materialization only: poll interval while waiting for git (default 500ms). */
  gitPollMs?: number;
}

export interface FailureInjectionHandle {
  boundary: FailureBoundary;
  /** True once the injection actually fired (a no-target boundary that could not act stays false). */
  injected: boolean;
  /** Idempotent teardown; safe (and expected) to call in a finally even if injection failed. */
  disarm(): Promise<void>;
}

/**
 * The side-effecting seams, all injectable. Defaults are the real e2b-verify
 * provider seams plus an on-box `candidate-server` container restart via the
 * world's box-exec. Unit tests pass fakes so no real provider/box is touched.
 */
export interface FailureInjectionSeams {
  execInProviderSandbox: typeof execInProviderSandbox;
  killProviderSandbox: typeof killProviderSandbox;
  pauseProviderSandbox: typeof pauseProviderSandbox;
  /** Restarts a named process/container ON the candidate box (default: `docker restart` via box-exec). */
  restartBoxProcess(world: ManagedCloudWorld, processName: string): Promise<void>;
}

/** The on-box container the workspace_creation boundary restarts. */
const CANDIDATE_SERVER_PROCESS = "candidate-server";

/**
 * Injects the named failure at `boundary` against `target`, returning a handle
 * with an idempotent `disarm()`. The caller retries through the NORMAL product
 * path after disarming; this fixture only breaks the accepted work, never
 * repairs it.
 */
export async function injectFailureAt(
  world: ManagedCloudWorld,
  boundary: FailureBoundary,
  target: FailureInjectionTarget,
  seams: Partial<FailureInjectionSeams> = {},
): Promise<FailureInjectionHandle> {
  const resolved: FailureInjectionSeams = {
    execInProviderSandbox: seams.execInProviderSandbox ?? execInProviderSandbox,
    killProviderSandbox: seams.killProviderSandbox ?? killProviderSandbox,
    pauseProviderSandbox: seams.pauseProviderSandbox ?? pauseProviderSandbox,
    restartBoxProcess: seams.restartBoxProcess ?? defaultRestartBoxProcess,
  };

  const noopHandle = (injected: boolean): FailureInjectionHandle => ({
    boundary,
    injected,
    async disarm() {
      // Idempotent no-op: the injection is a kill/restart the recovery journey
      // re-drives through the product, so there is nothing to undo. Kept as a
      // real method so callers can always `finally { await handle.disarm() }`.
    },
  });

  switch (boundary) {
    case "provider_create": {
      // The provider sandbox appeared; kill it before Worker enrollment so the
      // product must re-provision on the next /ensure.
      const providerSandboxId = requireProviderSandbox(boundary, target);
      const { killed } = await resolved.killProviderSandbox(providerSandboxId);
      return noopHandle(killed);
    }
    case "worker_enrollment": {
      // Kill the Worker before its first heartbeat, so enrollment never lands.
      // Proven present→absent; a missing Worker throws (never a fake success).
      const providerSandboxId = requireProviderSandbox(boundary, target);
      await killProcessInSandbox(resolved.execInProviderSandbox, providerSandboxId, "proliferate-worker");
      return noopHandle(true);
    }
    case "runtime_readiness": {
      // Kill AnyHarness before readiness flips, so the runtime never reports
      // ready. Proven present→absent; a missing runtime throws.
      const providerSandboxId = requireProviderSandbox(boundary, target);
      await killProcessInSandbox(resolved.execInProviderSandbox, providerSandboxId, "anyharness");
      return noopHandle(true);
    }
    case "repo_materialization": {
      // SIGKILL the IN-FLIGHT git clone/fetch INSIDE the sandbox, leaving the
      // partial checkout in place — the sandbox is NOT destroyed, so this
      // exercises partial-materialization RECOVERY (re-clone into the same
      // sandbox), not reprovisioning. Poll for the git process within a bounded
      // window; if none appears, THROW (never fall back to a sandbox kill).
      const providerSandboxId = requireProviderSandbox(boundary, target);
      await killInflightGitInSandbox(
        resolved.execInProviderSandbox,
        providerSandboxId,
        target.gitWaitMs ?? 30_000,
        target.gitPollMs ?? 500,
      );
      return noopHandle(true);
    }
    case "workspace_creation": {
      // Restart the candidate-server container between the accepted create and
      // its commit tail, so the product must re-run the tail on the next call.
      await resolved.restartBoxProcess(world, CANDIDATE_SERVER_PROCESS);
      return noopHandle(true);
    }
    default: {
      // Exhaustiveness: a new boundary must be handled explicitly, never
      // silently succeed as an injected failure that did nothing.
      const never: never = boundary;
      throw new Error(`injectFailureAt: unhandled failure boundary "${String(never)}".`);
    }
  }
}

/**
 * Enumerates PIDs inside the sandbox whose executable is EXACTLY `exeName`,
 * identified PRIMARILY by the basename of `/proc/<pid>/exe` (a symlink to the
 * real binary) — NEVER `pgrep -f`/`pkill -f` (which match the whole command line
 * and would match the enumerator's own `sh -c …` wrapper), and NOT bare
 * `/proc/<pid>/comm`, which Linux TRUNCATES to 15 bytes (so `proliferate-worker`,
 * 18 chars, never compares equal). Using the exe basename preserves the FULL
 * untruncated name and inherently excludes shell wrappers (their exe is `sh`/
 * `bash`).
 *
 * Where `/proc/<pid>/exe` is unreadable (permissions), it FALLS BACK to: comm
 * equals the target truncated to 15 bytes AND argv[0] basename (from
 * `/proc/<pid>/cmdline`) equals the full target. The enumerator excludes its own
 * pid (`$$`) and parent (`$PPID`). When `requireCmdline` is set it additionally
 * requires the cmdline to contain "clone" or "fetch" (in-flight `git`). Returns
 * the matched pids (empty = none). Fixed script text; only the target name is
 * interpolated.
 */
async function findPidsByExactExe(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  exeName: string,
  requireCmdline: "git-clone-fetch" | null = null,
): Promise<string[]> {
  const comm15 = exeName.slice(0, 15); // Linux /proc/<pid>/comm truncation width.
  const cmdlineFilter =
    requireCmdline === "git-clone-fetch"
      ? 'case "$cl" in *clone*|*fetch*) ;; *) continue ;; esac; '
      : "";
  // POSIX sh + /proc; busybox-compatible. `readlink -f` resolves the exe symlink;
  // argv0 basename via parameter expansion on the first NUL-delimited field.
  const script =
    "SELF=$$; " +
    "for d in /proc/[0-9]*; do " +
    "pid=${d#/proc/}; " +
    '[ "$pid" = "$SELF" ] && continue; ' +
    '[ "$pid" = "$PPID" ] && continue; ' +
    // cmdline (space-joined) + argv[0] basename, used by the git filter and the
    // fallback. argv[0] is the first NUL-delimited field: split on NUL → newlines,
    // take line 1.
    'cl=$(tr "\\0" " " < "$d/cmdline" 2>/dev/null); ' +
    'argv0=$(tr "\\0" "\\n" < "$d/cmdline" 2>/dev/null | head -n1); a0base=${argv0##*/}; ' +
    // PRIMARY: exe basename (full, untruncated). readlink may fail (perm/kernel).
    'exe=$(readlink "$d/exe" 2>/dev/null); ebase=${exe##*/}; ' +
    "matched=0; " +
    `if [ -n "$ebase" ]; then ` +
    `if [ "$ebase" = ${shellSingleQuote(exeName)} ]; then matched=1; fi; ` +
    // FALLBACK only when exe is unreadable: truncated comm AND full argv0 basename.
    `else c=$(cat "$d/comm" 2>/dev/null); ` +
    `if [ "$c" = ${shellSingleQuote(comm15)} ] && [ "$a0base" = ${shellSingleQuote(exeName)} ]; then matched=1; fi; fi; ` +
    '[ "$matched" = 1 ] || continue; ' +
    cmdlineFilter +
    'echo "$pid"; ' +
    "done";
  const result = await exec(providerSandboxId, ["sh", "-c", script]);
  return result.stdout
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^\d+$/.test(token));
}

/** Kills an explicit PID list with SIGKILL (never `pkill -f`) and returns the command result. */
async function killPids(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  pids: readonly string[],
): Promise<{ exitCode: number; stderr: string }> {
  const result = await exec(providerSandboxId, ["sh", "-c", `kill -9 ${pids.join(" ")}`]);
  return { exitCode: result.exitCode, stderr: result.stderr };
}

/** Re-checks each pid with `kill -0`; returns the pids STILL alive (empty = all gone). */
async function pidsStillAlive(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  pids: readonly string[],
): Promise<string[]> {
  const alive: string[] = [];
  for (const pid of pids) {
    // kill -0 exits 0 iff the pid exists (and is signalable); nonzero once gone.
    const check = await exec(providerSandboxId, ["sh", "-c", `kill -0 ${pid} 2>/dev/null && echo ALIVE || echo GONE`]);
    if (check.stdout.includes("ALIVE")) {
      alive.push(pid);
    }
  }
  return alive;
}

/**
 * Positively-proven process kill inside the sandbox by EXACT executable identity:
 * enumerate matching PIDs FIRST (a missing target THROWS — never a fake
 * injection), SIGKILL that exact PID list, then re-check those PIDs with
 * `kill -0` and require them all gone. Never `pkill -f`.
 */
async function killProcessInSandbox(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  exeName: string,
): Promise<void> {
  const before = await findPidsByExactExe(exec, providerSandboxId, exeName);
  if (before.length === 0) {
    throw new Error(
      `injectFailureAt: no process with executable "${exeName}" was running in the sandbox to kill — refusing to ` +
        "fabricate a successful injection (the boundary was not reached, or the target already exited).",
    );
  }
  const kill = await killPids(exec, providerSandboxId, before);
  if (kill.exitCode !== 0) {
    throw new Error(
      `injectFailureAt: kill -9 of "${exeName}" (pids ${before.join(",")}) exited ${kill.exitCode} ` +
        `(${kill.stderr.trim().slice(0, 200)}).`,
    );
  }
  const alive = await pidsStillAlive(exec, providerSandboxId, before);
  if (alive.length > 0) {
    throw new Error(
      `injectFailureAt: "${exeName}" was still running after SIGKILL (pids ${alive.join(",")}); the injection did ` +
        "not take effect.",
    );
  }
}

/**
 * SIGKILLs the in-flight `git` clone/fetch inside the sandbox by exact EXE
 * identity (`git`) + a cmdline that contains clone|fetch, leaving the partial
 * checkout in place. Polls for a matching process within a bounded window (the
 * clone is transient); once seen, kills that exact PID list and proves it gone
 * via `kill -0`. If no matching git appears in the window, THROWS — never falls
 * back to destroying the sandbox (that would exercise reprovisioning, not
 * partial-materialization recovery, which the boundary contract requires).
 */
async function killInflightGitInSandbox(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  waitMs: number,
  pollMs: number,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const pids = await findPidsByExactExe(exec, providerSandboxId, "git", "git-clone-fetch");
    if (pids.length > 0) {
      const kill = await killPids(exec, providerSandboxId, pids);
      if (kill.exitCode !== 0) {
        throw new Error(
          `injectFailureAt(repo_materialization): kill -9 of the in-flight git (pids ${pids.join(",")}) exited ` +
            `${kill.exitCode} (${kill.stderr.trim().slice(0, 200)}).`,
        );
      }
      const alive = await pidsStillAlive(exec, providerSandboxId, pids);
      if (alive.length > 0) {
        throw new Error(
          `injectFailureAt(repo_materialization): git was still running after SIGKILL (pids ${alive.join(",")}).`,
        );
      }
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `injectFailureAt(repo_materialization): no in-flight git clone/fetch observed within ${waitMs}ms — ` +
          "refusing to fall back to destroying the sandbox (that exercises reprovisioning, not partial-" +
          "materialization recovery). Widen gitWaitMs or inject earlier in the clone.",
      );
    }
    await sleep(pollMs);
  }
}

/** Escapes a value for single-quoted POSIX shell interpolation (mirrors box-exec.ts). */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireProviderSandbox(boundary: FailureBoundary, target: FailureInjectionTarget): string {
  if (!target.providerSandboxId) {
    throw new Error(`injectFailureAt: boundary "${boundary}" requires target.providerSandboxId.`);
  }
  return target.providerSandboxId;
}

/**
 * Default box-process restart: `sudo docker restart <name>` on the candidate box
 * via the world's box-exec seam. Throws if the world has no box (the on-box
 * boundary is not exercisable without one).
 */
async function defaultRestartBoxProcess(world: ManagedCloudWorld, processName: string): Promise<void> {
  if (!world.box) {
    throw new Error(
      "injectFailureAt(workspace_creation): the managed-cloud world exposes no box-exec seam; restarting the " +
        "candidate-server container requires the candidate box.",
    );
  }
  await world.box.exec(`sudo docker restart ${processName}`);
}
