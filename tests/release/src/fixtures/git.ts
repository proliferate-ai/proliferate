import { spawn, spawnSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ScenarioBlockedError } from "../scenarios/types.js";
import { redactUrlCredentials } from "../evidence/schema.js";

/**
 * Ensures a local clone of `owner/repo` exists at a stable scratch path,
 * reusing it across runs (git-fetching to keep it current) rather than
 * re-cloning every time. The default fixture repo (`proliferate-e2e/e2e-fixture`)
 * is public again (found flipped to private 2026-07-09, which failed every
 * anonymous CI clone with exit 128; restored to the documented public state).
 * Credential resolution, in order: an explicit `RELEASE_E2E_GITHUB_TEST_TOKEN`,
 * then the operator's own `gh` CLI auth (`gh auth token`), then anonymous
 * HTTPS. When the repo is unreachable with whatever this resolves (e.g. it
 * goes private again on a credential-less CI runner), this throws
 * `ScenarioBlockedError` so the scenario reports blocked-on-credential rather
 * than a spurious red, the same convention as any other absent-credential gate.
 */
export async function ensureLocalClone(
  ownerRepo: string,
  options: { token?: string } = {},
): Promise<string> {
  const dest = path.join(os.tmpdir(), "proliferate-release-e2e", "repos", ownerRepo.replace("/", "__"));
  await mkdir(path.dirname(dest), { recursive: true });
  const alreadyCloned = await pathExists(path.join(dest, ".git"));
  if (alreadyCloned) {
    await runGit(["fetch", "--all", "--prune"], dest);
    await runGit(["checkout", "main"], dest);
    await runGit(["reset", "--hard", "origin/main"], dest);
    await runGit(["clean", "-fdx"], dest);
    return dest;
  }
  const token = options.token ?? ghAuthToken();
  const url = token
    ? `https://x-access-token:${token}@github.com/${ownerRepo}.git`
    : `https://github.com/${ownerRepo}.git`;
  try {
    await runGit(["clone", url, dest], process.cwd());
  } catch (error) {
    if (isUnreachableCloneError(error)) {
      throw new ScenarioBlockedError(
        `blocked on fixture repo reachability — could not clone ${ownerRepo}. ` +
          "Set RELEASE_E2E_GITHUB_TEST_TOKEN to a token with read access (or authenticate the runner's " +
          "`gh` CLI, or point RELEASE_E2E_GITHUB_TEST_REPO at a repo this environment can reach). See " +
          "src/config/env-manifest.ts (RELEASE_E2E_GITHUB_TEST_REPO / _TOKEN).",
      );
    }
    throw error;
  }
  return dest;
}

/** Best-effort local fallback the env-manifest documents: reuse the operator's
 * `gh` CLI auth for read access to the fixture repo. Returns undefined when
 * `gh` is absent or not logged in (e.g. a CI runner). */
function ghAuthToken(): string | undefined {
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0) {
    return undefined;
  }
  const token = result.stdout.trim();
  return token.length > 0 ? token : undefined;
}

/** True when a clone failed because the repo could not be reached/authenticated
 * (as opposed to a genuine, non-credential git error worth surfacing as red). */
function isUnreachableCloneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Repository not found|Authentication failed|could not read Username|terminal prompts disabled|Permission denied|remote: Not Found|fatal: could not read|invalid credentials/i.test(
    message,
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders a git failure without leaking credentials: the clone URL may embed
 * a runtime-discovered token (`gh auth token`) that no environment-manifest
 * redaction knows about, and git also echoes the remote URL into stderr.
 * Exported for the production-path regression test.
 */
export function describeGitFailure(
  args: readonly string[],
  cwd: string,
  code: number | null,
  stderr: string,
): string {
  const shownArgs = args.map((arg) => redactUrlCredentials(arg)).join(" ");
  return `git ${shownArgs} (cwd=${cwd}) failed (${code}): ${redactUrlCredentials(stderr)}`;
}

function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // Never block on an interactive username/password prompt (a private repo
      // with no credential would otherwise hang a CI runner); fail fast so the
      // caller can classify it as unreachable.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(describeGitFailure(args, cwd, code, stderr)));
        return;
      }
      resolve();
    });
  });
}
