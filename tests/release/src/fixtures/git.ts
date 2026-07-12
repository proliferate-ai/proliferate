import { spawn, spawnSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ScenarioBlockedError } from "../scenarios/types.js";
import { redactSecrets } from "../report/redaction.js";

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
  const token = options.token ?? ghAuthToken();
  const url = `https://github.com/${ownerRepo}.git`;
  const alreadyCloned = await pathExists(path.join(dest, ".git"));
  if (alreadyCloned) {
    // Older harness versions embedded credentials in origin. Normalize the
    // persisted remote before any fetch so a local .git/config never retains
    // a tokenized URL.
    await runGit(["remote", "set-url", "origin", url], dest);
    await runGit(["fetch", "--all", "--prune"], dest, token);
    await runGit(["checkout", "main"], dest);
    await runGit(["reset", "--hard", "origin/main"], dest);
    await runGit(["clean", "-fdx"], dest);
    return dest;
  }
  try {
    await runGit(["clone", url, dest], process.cwd(), token);
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

function runGit(args: string[], cwd: string, token?: string): Promise<void> {
  const auth = gitAuthenticationEnvironment(token);
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // Never block on an interactive username/password prompt (a private repo
      // with no credential would otherwise hang a CI runner); fail fast so the
      // caller can classify it as unreachable.
      env: auth.env,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            redactSecrets(`git ${args.join(" ")} (cwd=${cwd}) failed (${code}): ${stderr}`, {
              additionalSecrets: auth.sensitiveValues,
            }),
          ),
        );
        return;
      }
      resolve();
    });
  });
}

export function gitAuthenticationEnvironment(token?: string): {
  env: NodeJS.ProcessEnv;
  sensitiveValues: string[];
} {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (!token) {
    return { env, sensitiveValues: [] };
  }
  // Pass the HTTPS auth header through Git's environment-backed config. The
  // credential is absent from the remote URL, argv, persisted .git/config,
  // and thrown command string.
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
  env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
  return { env, sensitiveValues: [token, basic, env.GIT_CONFIG_VALUE_0] };
}
