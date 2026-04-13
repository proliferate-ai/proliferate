import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const CODEX_NPM_INSTALL_ROOT = join(HOME, ".cache", "anyharness-tests", "codex-acp-npm");

function ensureExecutable(label: string, command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  process.stdout.write(`prepared ${label}\n`);
}

export function ensureLocalAgentLaunchers(): Record<string, string> {
  const claudeRepo = resolveRequiredRepoPath(
    "ANYHARNESS_TEST_CLAUDE_REPO",
    join(HOME, "claude-agent-acp"),
  );
  const geminiRepo = resolveRequiredRepoPath(
    "ANYHARNESS_TEST_GEMINI_REPO",
    join(HOME, "gemini-cli"),
  );
  const codexLauncher = resolveCodexLauncher();

  const claudeEntrypoint = join(claudeRepo, "dist", "index.js");
  const geminiEntrypoint = join(geminiRepo, "bundle", "gemini.js");
  const forceRebuild = process.env.ANYHARNESS_TEST_FORCE_AGENT_REBUILD === "1";
  const forceInstall = process.env.ANYHARNESS_TEST_FORCE_AGENT_INSTALL === "1";

  ensureNodeWorkspaceDependencies("claude-agent-acp", claudeRepo, forceInstall);
  ensureNodeWorkspaceDependencies("gemini-cli", geminiRepo, forceInstall);

  if (forceRebuild || !exists(claudeEntrypoint)) {
    ensureExecutable("claude-agent-acp", "npm", ["run", "build"], claudeRepo);
  }

  if (forceRebuild || !exists(geminiEntrypoint)) {
    ensureExecutable("gemini-cli", "npm", ["run", "bundle"], geminiRepo);
  }

  return {
    ANYHARNESS_CLAUDE_AGENT_PROGRAM: process.execPath,
    ANYHARNESS_CLAUDE_AGENT_ARGS_JSON: JSON.stringify([claudeEntrypoint]),
    ANYHARNESS_CLAUDE_AGENT_CWD: claudeRepo,
    ANYHARNESS_CODEX_AGENT_PROGRAM: codexLauncher.program,
    ANYHARNESS_CODEX_AGENT_ARGS_JSON: JSON.stringify(codexLauncher.args),
    ANYHARNESS_CODEX_AGENT_CWD: codexLauncher.cwd,
    ANYHARNESS_GEMINI_AGENT_PROGRAM: process.execPath,
    ANYHARNESS_GEMINI_AGENT_ARGS_JSON: JSON.stringify([
      geminiEntrypoint,
      "--experimental-acp",
    ]),
    ANYHARNESS_GEMINI_AGENT_CWD: geminiRepo,
  };
}

function resolveCodexLauncher(): { program: string; args: string[]; cwd: string } {
  const mode = process.env.ANYHARNESS_TEST_CODEX_LAUNCH_MODE?.trim() || "repo";
  if (mode === "npm") {
    return ensureCodexNpmLauncher();
  }

  const codexRepo = resolveRequiredRepoPath(
    "ANYHARNESS_TEST_CODEX_REPO",
    join(HOME, "codex-acp"),
  );
  const codexBinary = join(codexRepo, "target", "debug", "codex-acp");
  const forceRebuild = process.env.ANYHARNESS_TEST_FORCE_AGENT_REBUILD === "1";

  if (forceRebuild || !exists(codexBinary)) {
    ensureExecutable(
      "codex-acp",
      "cargo",
      ["build", "--manifest-path", join(codexRepo, "Cargo.toml"), "--bin", "codex-acp"],
      codexRepo,
    );
  }

  return { program: codexBinary, args: [], cwd: codexRepo };
}

function ensureCodexNpmLauncher(): { program: string; args: string[]; cwd: string } {
  const installRoot = process.env.ANYHARNESS_TEST_CODEX_NPM_ROOT?.trim() || CODEX_NPM_INSTALL_ROOT;
  const packageSpec =
    process.env.ANYHARNESS_TEST_CODEX_NPM_SPEC?.trim() || "@proliferateai/codex-acp@0.11.5";
  const forceInstall = process.env.ANYHARNESS_TEST_FORCE_AGENT_INSTALL === "1";
  const binaryPath = join(installRoot, "node_modules", ".bin", "codex-acp");

  mkdirSync(installRoot, { recursive: true });
  const packageJsonPath = join(installRoot, "package.json");
  if (!exists(packageJsonPath)) {
    writeFileSync(packageJsonPath, '{ "private": true }');
  }

  if (forceInstall || !exists(binaryPath)) {
    ensureExecutable(
      "codex-acp npm package",
      "npm",
      ["install", "--no-audit", "--no-fund", packageSpec],
      installRoot,
    );
  }

  return { program: binaryPath, args: [], cwd: installRoot };
}

function ensureNodeWorkspaceDependencies(
  label: string,
  cwd: string,
  forceInstall: boolean,
): void {
  if (!forceInstall && exists(join(cwd, "node_modules"))) {
    return;
  }

  if (exists(join(cwd, "package-lock.json"))) {
    ensureExecutable(`${label} dependencies`, "npm", ["ci", "--ignore-scripts"], cwd);
    return;
  }

  ensureExecutable(`${label} dependencies`, "npm", ["install", "--ignore-scripts"], cwd);
}

function exists(path: string): boolean {
  return existsSync(path);
}

function resolveRequiredRepoPath(envName: string, fallbackPath: string): string {
  const configuredPath = process.env[envName]?.trim() || fallbackPath;
  if (exists(configuredPath)) {
    return configuredPath;
  }

  throw new Error(
    `Missing local agent repo at ${configuredPath}. Set ${envName} to the checkout path before running the local agent suite.`,
  );
}
