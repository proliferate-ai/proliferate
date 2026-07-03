import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  AnyHarnessClient,
  reduceEvents,
  streamSession,
  type SessionEventEnvelope,
  type TranscriptState,
} from "@anyharness/sdk";

// Five levels up from src/scenarios/workspaces/ is the repo root (the
// `[workspace]` Cargo.toml lives there, one level above `anyharness/`) —
// that's also cargo's own default target dir when CARGO_TARGET_DIR isn't
// set, so the fallback below matches `cargo metadata`'s `target_directory`.
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR?.trim() || join(REPO_ROOT, "target");
const ANYHARNESS_BINARY = join(CARGO_TARGET_DIR, "debug", "anyharness");
const BRANCH_NAME = "mig-test";

const RUNTIME_SETUP_TIMEOUT_MS = 300_000;
const PROMPT_TIMEOUT_MS = 150_000;
const ROUND_TRIP_TEST_TIMEOUT_MS = 900_000;

/**
 * Promoted E1 experiment (specs/tbd/workspace-migration-v2.md §1, ported
 * from the session scratchpad's `mig-lab/e1_driver.py`). Two isolated
 * AnyHarness runtimes stand in for two machines. A real Claude session is
 * created on runtime A, told a codeword, frozen, and exported. The archive
 * installs into a fresh destination on runtime B with
 * `installMode: "preserve_native_sessions"`; without any manual database
 * surgery, the same engine session id on B natively resumes and recalls the
 * codeword (E1c: install v2 keeps `native_session_id` alive across a move).
 * The workspace then travels back to its original home on A — re-adopt
 * replaces A's stale leftover copy with B's archive in place instead of
 * refusing a duplicate session id, and the session still recalls the
 * codeword there too.
 *
 * Skips cleanly without Claude credentials on this machine, matching how
 * `scenarios/agents/*.test.ts` gate real-agent runs.
 */
describe.skipIf(!hasClaudeCredentials())(
  "mobility install v2: round-trip with native Claude session recall",
  () => {
    let labRoot!: string;
    let runtimeA!: MobilityRuntime;
    let runtimeB!: MobilityRuntime;
    let claudeProjectMarkers!: string[];

    beforeAll(async () => {
      execFileSync("cargo", ["build", "-p", "anyharness"], {
        cwd: REPO_ROOT,
        stdio: "inherit",
        env: process.env,
      });

      labRoot = await mkdtemp(join(tmpdir(), "anyharness-mobility-roundtrip-"));
      [runtimeA, runtimeB] = await Promise.all([
        spawnMobilityRuntime("a"),
        spawnMobilityRuntime("b"),
      ]);
      claudeProjectMarkers = [
        basename(labRoot),
        basename(runtimeA.runtimeHome),
        basename(runtimeB.runtimeHome),
        basename(runtimeA.worktreesRoot),
        basename(runtimeB.worktreesRoot),
      ];
    }, RUNTIME_SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await Promise.allSettled([runtimeA?.close(), runtimeB?.close()]);
      if (labRoot) {
        await rm(labRoot, { recursive: true, force: true });
      }
      await cleanupClaudeProjectSlugs(claudeProjectMarkers ?? []);
    });

    it(
      "keeps a Claude session natively resumable across install v2, then round-trips home via re-adopt",
      async () => {
        const codeword = `PLUM-${randomUUID().slice(0, 8).toUpperCase()}`;
        const repos = await createRoundTripRepos(labRoot);

        // --- A: create a workspace + a real Claude session, teach it the codeword ---
        const resolvedA = await runtimeA.client.workspaces.create({ path: repos.machineAPath });
        const originalWorkspaceId = resolvedA.workspace.id;

        const session = await runtimeA.client.sessions.create({
          workspaceId: originalWorkspaceId,
          agentKind: "claude",
        });
        const sessionId = session.id;

        const turn1 = await runtimeA.promptAndCollect(
          sessionId,
          `Remember this for later: the codeword is ${codeword}. Reply with exactly: STORED`,
          { timeoutMs: PROMPT_TIMEOUT_MS },
        );
        expect(
          assistantTextIncludes(turn1.transcript, "STORED"),
          describeTranscript(turn1.transcript),
        ).toBe(true);

        const sessionAfterTurn1 = await runtimeA.client.sessions.get(sessionId);
        const nativeSessionId = sessionAfterTurn1.nativeSessionId;
        expect(nativeSessionId).toBeTruthy();

        // --- A: freeze + export (requireCleanGitState + expected guards) ---
        const handoffOpIdLeg1 = `mobility-roundtrip-leg1-${randomUUID()}`;
        await runtimeA.client.mobility.updateRuntimeState(originalWorkspaceId, {
          mode: "frozen_for_handoff",
          handoffOpId: handoffOpIdLeg1,
        });
        const baseCommitSha = gitCapture(repos.machineAPath, ["rev-parse", "HEAD"]);

        // E1b guard chain: a mismatched handoff-op expectation refuses export
        // even though the workspace is frozen and the tree is clean.
        await expect(
          runtimeA.client.mobility.exportArchive(originalWorkspaceId, {
            requireCleanGitState: true,
            expectedHandoffOpId: "not-the-real-handoff-op",
            expectedBaseCommitSha: baseCommitSha,
            expectedBranchName: BRANCH_NAME,
          }),
        ).rejects.toThrow();

        const archiveLeg1 = await runtimeA.client.mobility.exportArchive(originalWorkspaceId, {
          excludePaths: [],
          requireCleanGitState: true,
          expectedHandoffOpId: handoffOpIdLeg1,
          expectedBaseCommitSha: baseCommitSha,
          expectedBranchName: BRANCH_NAME,
        });
        expect(archiveLeg1.sessions).toHaveLength(1);
        expect(archiveLeg1.sessions?.[0]?.session.id).toBe(sessionId);
        expect(archiveLeg1.sessions?.[0]?.session.nativeSessionId).toBe(nativeSessionId);

        // --- B: prepare a fresh destination + install with native ids preserved ---
        const repoRootB = await runtimeB.client.repoRoots.resolveFromPath(repos.machineBPath);
        const destination = await runtimeB.client.repoRoots.prepareDestination(repoRootB.id, {
          requestedBranch: BRANCH_NAME,
          requestedBaseSha: baseCommitSha,
        });
        const destinationWorkspaceId = destination.workspace.id;
        expect(destination.workspace.kind).toBe("worktree");

        const installLeg1 = await runtimeB.client.mobility.installArchive(destinationWorkspaceId, {
          archive: archiveLeg1,
          installMode: "preserve_native_sessions",
          operationId: "mobility-roundtrip-leg1",
        });
        expect(installLeg1.importedSessionIds).toEqual([sessionId]);

        // --- B: prompt the SAME engine session id — zero manual db surgery ---
        const sessionOnB = await runtimeB.client.sessions.get(sessionId);
        expect(sessionOnB.nativeSessionId).toBe(nativeSessionId);

        const turn2 = await runtimeB.promptAndCollect(
          sessionId,
          "What is the codeword I asked you to remember? Reply with exactly that word and nothing else.",
          { timeoutMs: PROMPT_TIMEOUT_MS },
        );
        expect(
          assistantTextIncludes(turn2.transcript, codeword),
          describeTranscript(turn2.transcript),
        ).toBe(true);

        // --- round trip: freeze on B, export, re-install into A's original workspace ---
        const handoffOpIdLeg2 = `mobility-roundtrip-leg2-${randomUUID()}`;
        await runtimeB.client.mobility.updateRuntimeState(destinationWorkspaceId, {
          mode: "frozen_for_handoff",
          handoffOpId: handoffOpIdLeg2,
        });
        const baseCommitShaLeg2 = gitCapture(destination.workspace.path, ["rev-parse", "HEAD"]);
        expect(baseCommitShaLeg2).toBe(baseCommitSha);

        const archiveLeg2 = await runtimeB.client.mobility.exportArchive(destinationWorkspaceId, {
          excludePaths: [],
          requireCleanGitState: true,
          expectedHandoffOpId: handoffOpIdLeg2,
          expectedBaseCommitSha: baseCommitShaLeg2,
          expectedBranchName: BRANCH_NAME,
        });
        expect(archiveLeg2.sessions?.[0]?.session.nativeSessionId).toBe(nativeSessionId);

        // A's own copy of this session is still sitting there from before the
        // handoff (never deleted). Mark A's workspace as this runtime's prior
        // home so install routes the duplicate archive session id through
        // re-adopt instead of `MobilityError::SessionAlreadyExists`.
        await runtimeA.client.mobility.updateRuntimeState(originalWorkspaceId, {
          mode: "remote_owned",
        });

        const installLeg2 = await runtimeA.client.mobility.installArchive(originalWorkspaceId, {
          archive: archiveLeg2,
          installMode: "preserve_native_sessions",
          operationId: "mobility-roundtrip-leg2",
        });
        expect(installLeg2.importedSessionIds).toEqual([sessionId]);

        // Install accepts `remote_owned` as a re-adopt destination, but the
        // workspace stays in that mode afterward (cutover is a separate,
        // caller-driven step in the real move flow) — prompting a session
        // still requires `normal` mode, so flip it back before turn 3.
        await runtimeA.client.mobility.updateRuntimeState(originalWorkspaceId, { mode: "normal" });

        const sessionsOnA = await runtimeA.client.sessions.list(originalWorkspaceId);
        expect(sessionsOnA).toHaveLength(1);
        expect(sessionsOnA[0]?.id).toBe(sessionId);
        expect(sessionsOnA[0]?.nativeSessionId).toBe(nativeSessionId);

        const turn3 = await runtimeA.promptAndCollect(
          sessionId,
          "One more time: what is the codeword? Reply with exactly that word and nothing else.",
          { timeoutMs: PROMPT_TIMEOUT_MS },
        );
        expect(
          assistantTextIncludes(turn3.transcript, codeword),
          describeTranscript(turn3.transcript),
        ).toBe(true);

        // --- destination placement regression: B's worktree purges cleanly ---
        // (mobility's own source-cleanup call, not the generic retire flow,
        // which refuses while a session row is still attached — this is the
        // real production call for a mobility destination that lost its
        // workspace to the round trip.) Before decision 4's fix, destination
        // worktrees lived outside `managed_worktrees_root()` and
        // `retire_worktree_materialization` refused to purge them.
        // destroy-source requires `remote_owned` (B's copy is stale now that
        // A is canonical again) — it's still `frozen_for_handoff` from the
        // leg-2 export above.
        await runtimeB.client.mobility.updateRuntimeState(destinationWorkspaceId, {
          mode: "remote_owned",
        });
        const destroyed = await runtimeB.client.mobility.destroySource(destinationWorkspaceId);
        expect(destroyed.sourceDestroyed).toBe(true);
      },
      ROUND_TRIP_TEST_TIMEOUT_MS,
    );
  },
);

interface MobilityRuntime {
  readonly label: string;
  readonly baseUrl: string;
  readonly authToken: string;
  readonly client: AnyHarnessClient;
  readonly runtimeHome: string;
  readonly worktreesRoot: string;
  promptAndCollect(
    sessionId: string,
    text: string,
    options?: { timeoutMs?: number },
  ): Promise<{ events: SessionEventEnvelope[]; transcript: TranscriptState }>;
  close(): Promise<void>;
}

async function spawnMobilityRuntime(label: string): Promise<MobilityRuntime> {
  const runtimeHome = await mkdtemp(join(tmpdir(), `anyharness-mobility-${label}-`));
  // `managed_worktrees_root` (domains/workspaces/managed_root.rs) defaults to
  // a *sibling* of runtime_home, not a child of it — pin it explicitly so
  // mobility destination worktrees land somewhere this runtime's cleanup
  // actually owns and removes.
  const worktreesRoot = await mkdtemp(join(tmpdir(), `anyharness-mobility-${label}-worktrees-`));
  const authToken = randomUUID();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  execFileSync(
    ANYHARNESS_BINARY,
    ["install-agents", "--runtime-home", runtimeHome, "--agent", "claude"],
    { cwd: REPO_ROOT, stdio: "inherit", env: process.env },
  );

  const child = spawn(
    ANYHARNESS_BINARY,
    [
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--runtime-home",
      runtimeHome,
      "--require-bearer-auth",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ANYHARNESS_BEARER_TOKEN: authToken,
        ANYHARNESS_WORKTREES_ROOT: worktreesRoot,
      },
      stdio: "pipe",
    },
  );
  const stderr: string[] = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  await waitForHealth(baseUrl, authToken, child, stderr);

  return {
    label,
    baseUrl,
    authToken,
    runtimeHome,
    worktreesRoot,
    client: new AnyHarnessClient({ baseUrl, authToken }),
    promptAndCollect: (sessionId, text, options) =>
      collectPrompt(baseUrl, authToken, sessionId, text, options),
    close: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
      await Promise.all([
        rm(runtimeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }),
        rm(worktreesRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }),
      ]);
    },
  };
}

async function collectPrompt(
  baseUrl: string,
  authToken: string,
  sessionId: string,
  text: string,
  options: { timeoutMs?: number } = {},
): Promise<{ events: SessionEventEnvelope[]; transcript: TranscriptState }> {
  const client = new AnyHarnessClient({ baseUrl, authToken });
  const events: SessionEventEnvelope[] = [];
  let closeStream: (() => void) | null = null;
  let settled = false;
  const timeoutMs = options.timeoutMs ?? 120_000;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // This session may already carry prior turns (native-resumed sessions do,
  // by construction). The stream endpoint replays the full backlog from
  // `after_seq ?? 0`, so without pinning `afterSeq` to the current
  // high-water mark, an old turn's replayed `turn_ended` would resolve this
  // call before the new turn even starts. `limit` here is a *turn* budget,
  // not a raw event count — with no `turnLimit` it still returns the newest
  // turn's boundary events (`[turn_started, ..., turn_ended]`), not
  // literally one row, so take the max `seq` across whatever comes back
  // rather than assuming the first element is the newest.
  const priorEvents = await client.sessions.listEvents(sessionId);
  const afterSeq = priorEvents.reduce((max, envelope) => Math.max(max, envelope.seq), 0);

  const completed = new Promise<void>((resolve, reject) => {
    const stream = streamSession({
      baseUrl,
      sessionId,
      authToken,
      afterSeq,
      onEvent: (envelope) => {
        events.push(envelope);
        if (envelope.event.type === "turn_ended" || envelope.event.type === "session_ended") {
          settled = true;
          stream.close();
          resolve();
        }
      },
      onError: (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      },
      onClose: () => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`session stream closed before completion in session ${sessionId}`));
      },
    });
    closeStream = () => stream.close();
  });

  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      closeStream?.();
      const lastEventType = events.at(-1)?.event.type ?? "none";
      reject(
        new Error(
          `timed out waiting for prompt completion in session ${sessionId} after ${timeoutMs}ms (events=${events.length}, lastEvent=${lastEventType})`,
        ),
      );
    }, timeoutMs);
  });

  try {
    await Promise.race([
      (async () => {
        await client.sessions.promptText(sessionId, text);
        await completed;
      })(),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  return { events, transcript: reduceEvents(events, sessionId) };
}

async function waitForHealth(
  baseUrl: string,
  authToken: string,
  child: ChildProcessWithoutNullStreams,
  stderr: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`anyharness exited early: ${stderr.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for anyharness health: ${stderr.join("")}`);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

interface RoundTripRepos {
  originPath: string;
  machineAPath: string;
  machineBPath: string;
}

/**
 * Bare origin + two clones at different absolute paths, standing in for two
 * machines pushing/fetching the same repo over a real remote (matches
 * `mig-lab/e1_driver.py`'s `machine-a`/`machine-b`/`origin.git` layout).
 */
async function createRoundTripRepos(labRoot: string): Promise<RoundTripRepos> {
  const originPath = join(labRoot, "origin.git");
  const machineAPath = join(labRoot, "machine-a", "repo");
  const machineBPath = join(labRoot, "machine-b", "repo");

  await mkdir(originPath, { recursive: true });
  gitRun(originPath, ["init", "--bare", "-b", BRANCH_NAME]);

  await mkdir(join(labRoot, "machine-a"), { recursive: true });
  gitRun(labRoot, ["clone", originPath, machineAPath]);
  configureGitIdentity(machineAPath);
  gitRun(machineAPath, ["checkout", "-B", BRANCH_NAME]);
  await writeFile(join(machineAPath, "README.md"), "# mobility round-trip fixture\n");
  gitRun(machineAPath, ["add", "README.md"]);
  gitRun(machineAPath, ["commit", "-m", "initial"]);
  gitRun(machineAPath, ["push", "origin", BRANCH_NAME]);

  await mkdir(join(labRoot, "machine-b"), { recursive: true });
  gitRun(labRoot, ["clone", originPath, machineBPath]);
  configureGitIdentity(machineBPath);
  // Move the repo root off `mig-test` so runtime B's prepare-destination can
  // check that branch out into its own managed worktree without a
  // branch-already-checked-out-elsewhere conflict (mirrors the live E1 probe).
  gitRun(machineBPath, ["checkout", "-B", "placeholder-main"]);

  return { originPath, machineAPath, machineBPath };
}

function configureGitIdentity(repoPath: string): void {
  gitRun(repoPath, ["config", "user.email", "mobility-tests@anyharness.local"]);
  gitRun(repoPath, ["config", "user.name", "AnyHarness Mobility Tests"]);
}

function gitRun(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function gitCapture(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function assistantTextIncludes(transcript: TranscriptState, needle: string): boolean {
  return Object.values(transcript.itemsById).some(
    (item) => item.kind === "assistant_prose" && item.text.includes(needle),
  );
}

function describeTranscript(transcript: TranscriptState): string {
  return Object.values(transcript.itemsById)
    .sort((left, right) => left.startedSeq - right.startedSeq)
    .map((item) => (item.kind === "assistant_prose" ? `assistant:${JSON.stringify(item.text)}` : item.kind))
    .join("\n");
}

function hasClaudeCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return true;
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return true;
  }
  if (process.env.ANYHARNESS_TEST_CLAUDE_PORTABLE_AUTH_JSON?.trim()) {
    return true;
  }
  return (
    existsSync(join(homedir(), ".claude", ".credentials.json"))
    || existsSync(join(homedir(), ".claude.json"))
  );
}

/**
 * Claude Code slugs a workspace's absolute path into its `~/.claude/projects`
 * directory name (`sanitize_claude_path`,
 * `domains/agents/portability/mod.rs`). This test's temp paths always embed
 * one of these markers, so a substring match reliably finds every project
 * directory this run created without recomputing that slug algorithm.
 */
async function cleanupClaudeProjectSlugs(markers: readonly string[]): Promise<void> {
  if (markers.length === 0) {
    return;
  }
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) {
    return;
  }
  const entries = await readdir(projectsDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && markers.some((marker) => entry.name.includes(marker)))
      .map((entry) => rm(join(projectsDir, entry.name), { recursive: true, force: true })),
  );
}
