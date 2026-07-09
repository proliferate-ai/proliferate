import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Ensures a local clone of `owner/repo` exists at a stable scratch path,
 * reusing it across runs (git-fetching to keep it current) rather than
 * re-cloning every time. The fixture repo (`proliferate-e2e/e2e-fixture`,
 * confirmed public 2026-07-08) needs no credential to clone read-only; when
 * `RELEASE_E2E_GITHUB_TEST_TOKEN` is unset this shells out to plain `git
 * clone` over HTTPS, which works for any public repo with no auth at all.
 */
export async function ensureLocalClone(
  ownerRepo: string,
  options: { token?: string } = {},
): Promise<string> {
  const dest = path.join(os.tmpdir(), "proliferate-release-e2e", "repos", ownerRepo.replace("/", "__"));
  await mkdir(path.dirname(dest), { recursive: true });
  const alreadyCloned = await pathExists(path.join(dest, ".git"));
  const url = options.token
    ? `https://x-access-token:${options.token}@github.com/${ownerRepo}.git`
    : `https://github.com/${ownerRepo}.git`;
  if (alreadyCloned) {
    await runGit(["fetch", "--all", "--prune"], dest);
    await runGit(["checkout", "main"], dest);
    await runGit(["reset", "--hard", "origin/main"], dest);
    await runGit(["clean", "-fdx"], dest);
    return dest;
  }
  await runGit(["clone", url, dest], process.cwd());
  return dest;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
