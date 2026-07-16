import assert from "node:assert/strict";
import { test } from "node:test";

import {
  injectFailureAt,
  type FailureBoundary,
  type FailureInjectionSeams,
} from "./failure-injection.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

interface Recorded {
  execs: Array<{ id: string; command: readonly string[] }>;
  kills: string[];
  pauses: string[];
  restarts: string[];
  boxCommands: string[];
}

/** One simulated in-sandbox process: pid, exact executable name (comm), full cmdline. */
/**
 * A simulated /proc entry. `exe` is the full executable path the `/proc/<pid>/
 * exe` symlink resolves to (empty string models an UNREADABLE exe → fallback
 * path). `comm` is modelled with REAL Linux 15-byte truncation applied by the
 * harness, so a test cannot cheat by supplying an untruncated comm.
 */
interface FakeProc {
  pid: string;
  /** Full exe path, e.g. "/usr/bin/proliferate-worker"; "" = exe unreadable. */
  exe: string;
  /** Full comm as the program set it (the harness truncates to 15 bytes like Linux). */
  comm: string;
  cmdline: string;
}

const TRUNC = (s: string): string => s.slice(0, 15); // Linux /proc/<pid>/comm width.
const BASENAME = (p: string): string => p.split("/").pop() ?? p;

/**
 * Models the in-sandbox process table the fixture inspects via `/proc`. The fake
 * INTERPRETS the fixture's enumeration script the SAME way the real shell would:
 * primary match on `/proc/<pid>/exe` basename == target; fallback (when exe is
 * unreadable) on TRUNCATED-to-15-byte comm == target[:15] AND argv[0] basename ==
 * target. It applies REAL 15-byte comm truncation, honors the clone|fetch cmdline
 * filter, and `kill -9 <pids>` / `kill -0 <pid>` — so a wrapper (exe=sh, pattern
 * only in cmdline) is proven NOT killed, and a full-18-char worker whose comm is
 * truncated to `proliferate-wor` is still found via exe.
 */
function harness(
  overrides: {
    procs?: FakeProc[];
    hasBox?: boolean;
    killExit?: number;
    unkillable?: boolean;
  } = {},
): {
  world: ManagedCloudWorld;
  seams: Partial<FailureInjectionSeams>;
  recorded: Recorded;
  procs: Map<string, FakeProc>;
} {
  const recorded: Recorded = { execs: [], kills: [], pauses: [], restarts: [], boxCommands: [] };
  const procs = new Map<string, FakeProc>((overrides.procs ?? []).map((p) => [p.pid, p]));
  const box = {
    async exec(command: string) {
      recorded.boxCommands.push(command);
      return { stdout: "", stderr: "" };
    },
  } as unknown as BoxExec;
  const world = {
    run: { run_id: "r", shard_id: "s" },
    box: overrides.hasBox === false ? undefined : box,
  } as unknown as ManagedCloudWorld;

  const seams: Partial<FailureInjectionSeams> = {
    async execInProviderSandbox(id, command) {
      recorded.execs.push({ id, command });
      const script = command.join(" ");
      // Fail loudly if the fixture ever uses the banned whole-cmdline matchers.
      assert.ok(!/pgrep\s+-f/.test(script), "fixture must not use pgrep -f");
      assert.ok(!/pkill\s+-f/.test(script), "fixture must not use pkill -f");

      // Enumeration: the fixture's `/proc` walk matches by exe basename (primary)
      // with a truncated-comm + argv0-basename fallback, optionally filtered to a
      // clone|fetch cmdline. Recover the FULL target from `[ "$ebase" = 'X' ]` and
      // the truncated target from `[ "$c" = 'Y' ]`.
      if (script.includes("/proc/[0-9]*")) {
        const exeTargetMatch = /\[ "\$ebase" = '([^']+)' \]/.exec(script);
        const commTargetMatch = /\[ "\$c" = '([^']+)' \]/.exec(script);
        const exeTarget = exeTargetMatch?.[1];
        const commTarget = commTargetMatch?.[1]; // already truncated to 15 by the fixture
        const requireCloneFetch = /\*clone\*\|\*fetch\*/.test(script);
        const matched = [...procs.values()].filter((p) => {
          let isMatch = false;
          if (p.exe) {
            // PRIMARY: exe basename == full target.
            isMatch = BASENAME(p.exe) === exeTarget;
          } else {
            // FALLBACK: truncated comm == truncated target AND argv0 basename == full target.
            const argv0 = p.cmdline.split(" ")[0] ?? "";
            isMatch = TRUNC(p.comm) === commTarget && BASENAME(argv0) === exeTarget;
          }
          if (!isMatch) return false;
          if (requireCloneFetch && !/clone|fetch/.test(p.cmdline)) return false;
          return true;
        });
        return { stdout: matched.map((p) => p.pid).join("\n"), stderr: "", exitCode: 0 };
      }

      // kill -9 <pids> (the fixture's script is `kill -9 <pid> <pid> …`).
      const kill9 = /kill -9 ((?:\d+ ?)+)/.exec(script);
      if (kill9) {
        if (overrides.killExit !== undefined) {
          return { stdout: "", stderr: "kill failed", exitCode: overrides.killExit };
        }
        if (!overrides.unkillable) {
          for (const pid of kill9[1].trim().split(/\s+/)) procs.delete(pid);
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      // kill -0 <pid> && echo ALIVE || echo GONE
      const kill0 = /kill -0 (\d+)/.exec(script);
      if (kill0) {
        return { stdout: procs.has(kill0[1]) ? "ALIVE" : "GONE", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async killProviderSandbox(id) {
      recorded.kills.push(id);
      return { killed: true };
    },
    async pauseProviderSandbox(id) {
      recorded.pauses.push(id);
      return { paused: true };
    },
    async restartBoxProcess(_world, name) {
      recorded.restarts.push(name);
    },
  };
  return { world, seams, recorded, procs };
}

// The Worker's real comm truncates to `proliferate-wor` (15 bytes); its exe
// symlink keeps the FULL name, which is how the fixture must identify it.
const workerProc = (pid = "1001"): FakeProc => ({
  pid,
  exe: "/usr/local/bin/proliferate-worker",
  comm: "proliferate-worker",
  cmdline: "/usr/local/bin/proliferate-worker --enroll",
});
const anyharnessProc = (pid = "1002"): FakeProc => ({
  pid,
  exe: "/usr/local/bin/anyharness",
  comm: "anyharness",
  cmdline: "/usr/local/bin/anyharness serve",
});
const gitCloneProc = (pid = "1003"): FakeProc => ({
  pid,
  exe: "/usr/bin/git",
  comm: "git",
  cmdline: "/usr/bin/git clone https://x/y",
});

test("provider_create kills the provider sandbox and reports injected", async () => {
  const { world, seams, recorded } = harness();
  const handle = await injectFailureAt(world, "provider_create", { providerSandboxId: "sbx-1" }, seams);
  assert.equal(handle.boundary, "provider_create");
  assert.equal(handle.injected, true);
  assert.deepEqual(recorded.kills, ["sbx-1"]);
  // disarm is idempotent and always safe in a finally.
  await handle.disarm();
  await handle.disarm();
});

test("worker_enrollment finds the worker by EXE identity despite the 15-byte comm truncation, kills it, proves it gone", async () => {
  // The Worker's comm is truncated to `proliferate-wor` (15 bytes) — a bare comm
  // compare against the full `proliferate-worker` would NEVER match. The fixture
  // matches on the exe basename, so the worker is still found.
  const { world, seams, recorded, procs } = harness({ procs: [workerProc()] });
  assert.equal(TRUNC("proliferate-worker"), "proliferate-wor"); // sanity: truncation is real
  const handle = await injectFailureAt(world, "worker_enrollment", { providerSandboxId: "sbx-2" }, seams);
  assert.equal(handle.injected, true);
  // Never pgrep -f/pkill -f (the harness asserts this too). It enumerates /proc,
  // kills by explicit pid, and verifies with kill -0.
  assert.ok(recorded.execs.some((e) => e.command.join(" ").includes("/proc/[0-9]*")));
  assert.ok(recorded.execs.some((e) => e.command.join(" ").includes("/proc/$pid/exe") || e.command.join(" ").includes("readlink")));
  assert.ok(recorded.execs.some((e) => /kill -9 1001/.test(e.command.join(" "))));
  assert.ok(recorded.execs.some((e) => /kill -0 1001/.test(e.command.join(" "))));
  assert.equal(procs.has("1001"), false);
});

test("worker is still found via the FALLBACK (truncated comm + argv0 basename) when /proc/<pid>/exe is unreadable", async () => {
  // exe: "" models an unreadable /proc/<pid>/exe (permissions). The fallback must
  // match truncated comm (proliferate-wor) AND argv[0] basename (proliferate-worker).
  const unreadableExeWorker: FakeProc = {
    pid: "1005",
    exe: "",
    comm: "proliferate-worker",
    cmdline: "/usr/local/bin/proliferate-worker --enroll",
  };
  const { world, seams, procs } = harness({ procs: [unreadableExeWorker] });
  const handle = await injectFailureAt(world, "worker_enrollment", { providerSandboxId: "sbx-2b" }, seams);
  assert.equal(handle.injected, true);
  assert.equal(procs.has("1005"), false);
});

test("runtime_readiness proves anyharness present, kills the PID, proves it gone", async () => {
  const { world, seams, procs } = harness({ procs: [anyharnessProc()] });
  const handle = await injectFailureAt(world, "runtime_readiness", { providerSandboxId: "sbx-3" }, seams);
  assert.equal(handle.injected, true);
  assert.equal(procs.has("1002"), false);
});

test("a wrapper process that merely CONTAINS the pattern in its cmdline (exe=sh) is NOT killed, and a missing target throws", async () => {
  // A shell wrapper whose command line mentions the pattern but whose executable
  // is `sh` — the old pkill -f would have matched (and could kill the controller);
  // exe-identity matching must NOT select it, so the target is treated as absent.
  const wrapper: FakeProc = {
    pid: "2001",
    exe: "/bin/sh",
    comm: "sh",
    cmdline: "/bin/sh -c pkill proliferate-worker",
  };
  const { world, seams, procs } = harness({ procs: [wrapper] });
  await assert.rejects(
    () => injectFailureAt(world, "worker_enrollment", { providerSandboxId: "sbx-x" }, seams),
    /no process with executable "proliferate-worker" was running/,
  );
  // The wrapper survived — it was never a match.
  assert.equal(procs.has("2001"), true);
});

test("a MISSING target process throws (never fabricates a successful injection)", async () => {
  const { world, seams } = harness({ procs: [] });
  await assert.rejects(
    () => injectFailureAt(world, "worker_enrollment", { providerSandboxId: "sbx-x" }, seams),
    /no process with executable "proliferate-worker" was running/,
  );
});

test("a kill -9 that exits non-zero throws (no `|| true` masking the real command)", async () => {
  const { world, seams } = harness({ procs: [anyharnessProc()], killExit: 2 });
  await assert.rejects(
    () => injectFailureAt(world, "runtime_readiness", { providerSandboxId: "sbx-x" }, seams),
    /kill -9 of "anyharness" .* exited 2/,
  );
});

test("a target still alive after SIGKILL (kill -0 ALIVE) throws (injection did not take effect)", async () => {
  const { world, seams } = harness({ procs: [workerProc()], unkillable: true });
  await assert.rejects(
    () => injectFailureAt(world, "worker_enrollment", { providerSandboxId: "sbx-x" }, seams),
    /still running after SIGKILL/,
  );
});

test("repo_materialization SIGKILLs the in-flight git (comm=git + clone/fetch cmdline) and leaves the sandbox alive", async () => {
  const { world, seams, recorded, procs } = harness({ procs: [gitCloneProc()] });
  const handle = await injectFailureAt(
    world,
    "repo_materialization",
    { providerSandboxId: "sbx-4", gitWaitMs: 1_000, gitPollMs: 10 },
    seams,
  );
  assert.equal(handle.injected, true);
  // The sandbox was NOT destroyed — recovery is partial-materialization, not reprovisioning.
  assert.deepEqual(recorded.kills, []);
  // The git PID was killed by explicit pid (never pkill -f) and is gone.
  assert.ok(recorded.execs.some((e) => /kill -9 1003/.test(e.command.join(" "))));
  assert.equal(procs.has("1003"), false);
});

test("repo_materialization does NOT kill a `git` that is not clone/fetch (cmdline filter), and throws when none appears", async () => {
  const gitStatus: FakeProc = { pid: "3001", exe: "/usr/bin/git", comm: "git", cmdline: "/usr/bin/git status" };
  const { world, seams, recorded, procs } = harness({ procs: [gitStatus] });
  await assert.rejects(
    () =>
      injectFailureAt(
        world,
        "repo_materialization",
        { providerSandboxId: "sbx-5", gitWaitMs: 50, gitPollMs: 10 },
        seams,
      ),
    /no in-flight git clone\/fetch observed/,
  );
  assert.deepEqual(recorded.kills, [], "must NOT destroy the sandbox as a fallback");
  assert.equal(procs.has("3001"), true, "an unrelated `git status` must not be killed");
});

test("workspace_creation restarts the candidate-server container (no provider sandbox needed)", async () => {
  const { world, seams, recorded } = harness();
  const handle = await injectFailureAt(world, "workspace_creation", {}, seams);
  assert.equal(handle.injected, true);
  assert.deepEqual(recorded.restarts, ["candidate-server"]);
});

test("the default box-restart path issues `docker restart candidate-server` on the box", async () => {
  const { world, recorded } = harness();
  const handle = await injectFailureAt(world, "workspace_creation", {}, {
    // leave restartBoxProcess default
  });
  assert.equal(handle.injected, true);
  assert.deepEqual(recorded.boxCommands, ["sudo docker restart candidate-server"]);
});

test("every provider-sandbox boundary requires a providerSandboxId", async () => {
  const { world, seams } = harness();
  const boundaries: FailureBoundary[] = [
    "provider_create",
    "worker_enrollment",
    "runtime_readiness",
    "repo_materialization",
  ];
  for (const boundary of boundaries) {
    await assert.rejects(() => injectFailureAt(world, boundary, {}, seams), /requires target\.providerSandboxId/);
  }
});

test("workspace_creation without a box throws (the on-box boundary needs the candidate box)", async () => {
  const { world } = harness({ hasBox: false });
  await assert.rejects(() => injectFailureAt(world, "workspace_creation", {}, {}), /no box-exec seam/);
});

test("the fixture never touches the pause seam (recovery is via the normal product path)", async () => {
  const { world, seams, recorded } = harness({ procs: [workerProc()] });
  await injectFailureAt(world, "worker_enrollment", { providerSandboxId: "sbx-9" }, seams);
  assert.deepEqual(recorded.pauses, []);
});
