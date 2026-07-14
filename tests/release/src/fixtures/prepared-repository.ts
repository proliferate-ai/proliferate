import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_GITHUB_TEST_REPO } from "../config/env-manifest.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";

/**
 * `preparedRepository(actor)` (spec "Fixtures"). Prerequisite state only:
 *
 *   - clones the durable public qualification repository into a unique
 *     `run/shard/cell` directory (no shared mutable clone is reused);
 *   - checks out the pinned baseline commit;
 *   - calls the real AnyHarness `POST /v1/repo-roots/resolve` path used after
 *     the Desktop folder picker; and
 *   - returns the path, repository identity, commit, and runtime repo-root id.
 *
 * Native folder-picker behavior is out of scope for this browser-renderer slice.
 *
 * Repo/commit resolution follows the existing `RELEASE_E2E_GITHUB_TEST_REPO`
 * pattern (`src/config/env-manifest.ts`, default
 * `proliferate-e2e/e2e-fixture`), NOT the shared-scratch-path
 * `ensureLocalClone()` helper in `src/fixtures/git.ts` — that helper
 * deliberately reuses one mutable clone across runs, which the spec's
 * "no shared mutable clone is reused between runs" requirement rules out here.
 * `DEFAULT_BASELINE_COMMIT` is a real, durable commit on that repo's default
 * branch (`main`), pinned to a full SHA; override via
 * `PreparedRepositoryOptions.commit` (or the scenario's typed input) if that
 * repository's history changes.
 *
 * `POST /v1/repo-roots/resolve` on the local AnyHarness runtime
 * (`anyharness/crates/anyharness-lib/src/api/http/repo_roots.rs`) is not yet
 * exposed on `LocalRuntimeClient` (`src/fixtures/local-runtime.ts`, owned by
 * workstream A / reused-not-edited by this workstream) — this module calls it
 * directly via `fetch` against `world.runtime.baseUrl`. Flagged for the
 * integrator: `resolveRepoRoot` belongs on `LocalRuntimeClient` long-term.
 */

export interface PreparedRepository {
  /** Absolute path to the run/shard/cell-scoped clone. */
  path: string;
  /** Public qualification repo URL that was cloned. */
  repoUrl: string;
  /** Pinned baseline commit that was checked out. */
  commit: string;
  /** Runtime repo-root id returned by `POST /v1/repo-roots/resolve`. */
  repoRootId: string;
}

export interface PreparedRepositoryOptions {
  /** Overrides the default durable public qualification repo. */
  repoUrl?: string;
  /** Overrides the default pinned baseline commit. */
  commit?: string;
  /** Cell id, so concurrent cells clone into disjoint directories. */
  cellId?: string;
}

/**
 * Pinned baseline commit on the durable qualification repo's default branch
 * (`proliferate-e2e/e2e-fixture` @ `main`). Pinned to a full, durable SHA
 * (confirmed live via `gh api repos/proliferate-e2e/e2e-fixture/commits/main`
 * on 2026-07-14) so every run checks out the exact same bytes; a
 * wrong/absent SHA fails the clone loudly rather than silently.
 */
export const DEFAULT_BASELINE_COMMIT = "b70a83eda743a4ad615e33483bc8943055d3aa7d";

function defaultRepoUrl(): string {
  return `https://github.com/${DEFAULT_GITHUB_TEST_REPO}.git`;
}

/**
 * Every filesystem/process/network side effect this fixture performs,
 * factored out so unit tests can fake git and the runtime HTTP call without a
 * real clone or a running AnyHarness. The default is what production wiring
 * uses.
 */
export interface PreparedRepositoryTransport {
  ensureCleanDir(dirPath: string): Promise<void>;
  cloneAndCheckout(repoUrl: string, commit: string, destDir: string): Promise<void>;
  resolveRepoRoot(runtimeBaseUrl: string, repoPath: string): Promise<{ id: string }>;
}

export const defaultPreparedRepositoryTransport: PreparedRepositoryTransport = {
  async ensureCleanDir(dirPath) {
    await rm(dirPath, { recursive: true, force: true });
    await mkdir(dirPath, { recursive: true });
  },
  async cloneAndCheckout(repoUrl, commit, destDir) {
    await runGit(["clone", repoUrl, destDir], process.cwd());
    await runGit(["checkout", commit], destDir);
  },
  async resolveRepoRoot(runtimeBaseUrl, repoPath) {
    const response = await fetch(`${runtimeBaseUrl.replace(/\/+$/, "")}/v1/repo-roots/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: repoPath }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST /v1/repo-roots/resolve -> ${response.status}: ${text.slice(0, 2000)}`);
    }
    return (await response.json()) as { id: string };
  },
};

export async function preparedRepository(
  world: ReadyLocalWorld,
  actor: AuthenticatedActor,
  options?: PreparedRepositoryOptions,
  transport: PreparedRepositoryTransport = defaultPreparedRepositoryTransport,
): Promise<PreparedRepository> {
  void actor; // prerequisite state only; the repository is not actor-scoped
  const repoUrl = options?.repoUrl ?? defaultRepoUrl();
  const commit = options?.commit ?? DEFAULT_BASELINE_COMMIT;
  const cellId = options?.cellId ?? "default";
  // Filesystem-safe, still-unique clone directory. `encodeURIComponent(cellId)`
  // produced literal `%2F`/`%3D` in the path (cell id "…/local/harness=claude"),
  // an unusual workspace path that the desktop workspace-entry / agent launch
  // path can mishandle. Sanitize to `[A-Za-z0-9._-]` and append a short cellId
  // hash so distinct cells still clone into disjoint directories.
  const safeCellDir = `${cellId.replace(/[^A-Za-z0-9._-]+/g, "-")}-${cellIdHash(cellId)}`;
  const destDir = path.join(world.paths.repositoriesDir, safeCellDir);

  await transport.ensureCleanDir(destDir);
  await transport.cloneAndCheckout(repoUrl, commit, destDir);
  const repoRoot = await transport.resolveRepoRoot(world.runtime.baseUrl, destDir);

  return { path: destDir, repoUrl, commit, repoRootId: repoRoot.id };
}

function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} (cwd=${cwd}) failed (${code}): ${stderr}`));
        return;
      }
      resolve();
    });
  });
}

/** Short, stable hash of a cell id so distinct cells clone into disjoint dirs. */
function cellIdHash(cellId: string): string {
  return createHash("sha256").update(cellId).digest("hex").slice(0, 8);
}
