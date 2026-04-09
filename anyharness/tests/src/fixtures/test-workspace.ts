import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

export interface TestWorkspace {
  path: string;
  pathAccess: "local" | "remote";
  cleanup: () => Promise<void>;
}

export async function createTestWorkspace(name = "workspace"): Promise<TestWorkspace> {
  const path = await mkdtemp(join(tmpdir(), `anyharness-${slug(name)}-`));
  execFileSync("git", ["init", "-b", "main"], { cwd: path, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tests@anyharness.local"], {
    cwd: path,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "AnyHarness Tests"], {
    cwd: path,
    stdio: "pipe",
  });
  await writeFile(join(path, "README.md"), "# AnyHarness Test Workspace\n");
  execFileSync("git", ["add", "README.md"], { cwd: path, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: path, stdio: "pipe" });

  return {
    path,
    pathAccess: "local",
    cleanup: async () => {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "workspace";
}
