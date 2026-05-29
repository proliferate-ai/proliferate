import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const ANYHARNESS_BINARY = join(REPO_ROOT, "target", "debug", "anyharness");
const DEFAULT_AGENTS = ["claude", "codex", "gemini"];
const DEFAULT_FIXTURE_REF = "main";
const DEFAULT_GIT_USER_NAME = "AnyHarness Tests";
const DEFAULT_GIT_USER_EMAIL = "tests@anyharness.local";
const DEFAULT_READY_TIMEOUT_MS = 60_000;

export async function prepareAgentRuntimeSuite(options = {}) {
  const baseDir = options.baseDir ?? await mkdtemp(join(tmpdir(), "anyharness-agent-runtime-"));
  const runtimeHome = options.runtimeHome ?? join(baseDir, "runtime-home");
  const workspacePath = options.workspacePath ?? join(baseDir, "workspace");
  const runtimeLogPath = options.runtimeLogPath ?? join(baseDir, "runtime.log");
  const stateFile = options.stateFile ?? join(baseDir, "state.json");
  const envFile = options.envFile;
  const fixtureRepoUrl = options.fixtureRepoUrl ?? resolveFixtureRepoUrl();
  const fixtureRepoRef = options.fixtureRepoRef
    ?? (process.env.ANYHARNESS_TEST_FIXTURE_REPO_REF?.trim() || DEFAULT_FIXTURE_REF);
  const requiredAgents = normalizeAgents(
    options.requiredAgents
    ?? process.env.ANYHARNESS_TEST_REQUIRED_AGENTS
    ?? process.env.ANYHARNESS_TEST_READY_AGENT_KINDS
    ?? DEFAULT_AGENTS.join(","),
  );
  const skipReadyCheck = options.skipReadyCheck ?? false;
  const readyCheckTimeoutMs = options.readyCheckTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const authToken = options.authToken ?? randomUUID();
  const port = options.port ?? await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const githubToken = options.githubToken ?? resolveGitHubToken();

  let child = null;

  try {
    await mkdir(baseDir, { recursive: true });
    await mkdir(runtimeHome, { recursive: true });
    await seedGeminiOauthCredentials();
    buildAnyHarness();
    await cloneFixtureRepo({
      fixtureRepoUrl,
      fixtureRepoRef,
      workspacePath,
      githubToken,
      gitUserName: options.gitUserName ?? DEFAULT_GIT_USER_NAME,
      gitUserEmail: options.gitUserEmail ?? DEFAULT_GIT_USER_EMAIL,
    });
    installAgents(runtimeHome, requiredAgents);

    child = startRuntime({
      runtimeHome,
      runtimeLogPath,
      authToken,
      port,
    });
    await waitForHealth(baseUrl, authToken, child.pid, runtimeLogPath);

    const readyAgentKinds = skipReadyCheck
      ? requiredAgents
      : await waitForReadyAgents({
        baseUrl,
        authToken,
        requiredAgents,
        timeoutMs: readyCheckTimeoutMs,
      });

    const env = buildTestEnv({
      baseUrl,
      authToken,
      workspacePath,
      readyAgentKinds,
      stateFile,
      fixtureRepoUrl,
      fixtureRepoRef,
    });

    const state = {
      version: 1,
      createdAt: new Date().toISOString(),
      pid: child.pid,
      port,
      baseDir,
      runtimeHome,
      runtimeLogPath,
      workspacePath,
      baseUrl,
      authToken,
      requiredAgents,
      readyAgentKinds,
      fixtureRepoUrl,
      fixtureRepoRef,
      envFile: envFile ?? null,
      env,
    };

    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    if (envFile) {
      await writeEnvFile(envFile, env);
    }

    return { state, env };
  } catch (error) {
    if (child?.pid) {
      await stopProcess(child.pid);
    }
    await rm(baseDir, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupAgentRuntimeSuite(input) {
  const state = "stateFile" in input
    ? JSON.parse(await readFile(input.stateFile, "utf8"))
    : input.state;

  await stopProcess(state.pid);
  await rm(state.baseDir, { recursive: true, force: true });
  if (state.envFile) {
    await rm(state.envFile, { force: true });
  }

  if ("stateFile" in input) {
    await rm(input.stateFile, { force: true });
  }
}

function buildAnyHarness() {
  execFileSync("cargo", ["build", "--bin", "anyharness"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
}

function installAgents(runtimeHome, requiredAgents) {
  if (requiredAgents.length === 0) {
    return;
  }

  execFileSync(
    ANYHARNESS_BINARY,
    [
      "install-agents",
      "--runtime-home",
      runtimeHome,
      ...requiredAgents.flatMap((kind) => ["--agent", kind]),
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    },
  );
}

async function cloneFixtureRepo({
  fixtureRepoUrl,
  fixtureRepoRef,
  workspacePath,
  githubToken,
  gitUserName,
  gitUserEmail,
}) {
  await rm(workspacePath, { recursive: true, force: true });
  await mkdir(path.dirname(workspacePath), { recursive: true });

  const childEnv = {
    ...process.env,
    ...(githubToken ? { GH_TOKEN: githubToken, GITHUB_TOKEN: githubToken } : {}),
  };
  const gitHubAuthArgs = buildGitHubAuthArgs(githubToken, fixtureRepoUrl);
  const cloneUrl = normalizeFixtureCloneUrl(fixtureRepoUrl, githubToken);

  execFileSync("git", [...gitHubAuthArgs, "clone", "--no-tags", "--depth", "1", cloneUrl, workspacePath], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: childEnv,
  });

  execFileSync("git", [...gitHubAuthArgs, "fetch", "--depth", "1", "origin", fixtureRepoRef], {
    cwd: workspacePath,
    stdio: "inherit",
    env: childEnv,
  });
  execFileSync("git", ["checkout", "-B", "anyharness-test-fixture", "FETCH_HEAD"], {
    cwd: workspacePath,
    stdio: "inherit",
    env: childEnv,
  });
  execFileSync("git", ["clean", "-fdx"], {
    cwd: workspacePath,
    stdio: "inherit",
    env: childEnv,
  });
  execFileSync("git", ["config", "user.name", gitUserName], {
    cwd: workspacePath,
    stdio: "inherit",
    env: childEnv,
  });
  execFileSync("git", ["config", "user.email", gitUserEmail], {
    cwd: workspacePath,
    stdio: "inherit",
    env: childEnv,
  });
}

function startRuntime({ runtimeHome, runtimeLogPath, authToken, port }) {
  mkdirSync(path.dirname(runtimeLogPath), { recursive: true });
  const logFd = openSync(runtimeLogPath, "a");

  try {
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
        },
        detached: true,
        stdio: ["ignore", logFd, logFd],
      },
    );

    child.unref();
    return child;
  } finally {
    closeSync(logFd);
  }
}

async function waitForHealth(baseUrl, authToken, pid, runtimeLogPath) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!(await isProcessAlive(pid))) {
      throw new Error(`AnyHarness exited early:\n${await readRuntimeLog(runtimeLogPath)}`);
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

    await delay(1000);
  }

  throw new Error(`Timed out waiting for AnyHarness health:\n${await readRuntimeLog(runtimeLogPath)}`);
}

async function waitForReadyAgents({
  baseUrl,
  authToken,
  requiredAgents,
  timeoutMs,
}) {
  if (requiredAgents.length === 0) {
    return [];
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/v1/agents`, {
      headers: { authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to list agents for readiness check (${response.status})`);
    }

    const agents = await response.json();
    const readinessByKind = new Map(
      agents.map((agent) => [
        agent.kind,
        { readiness: agent.readiness, credentialState: agent.credentialState, message: agent.message },
      ]),
    );

    const pending = requiredAgents.filter((kind) => readinessByKind.get(kind)?.readiness !== "ready");
    if (pending.length === 0) {
      return requiredAgents;
    }

    await delay(1000);
  }

  const response = await fetch(`${baseUrl}/v1/agents`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
  const agents = response.ok ? await response.json() : [];
  const summary = agents
    .filter((agent) => requiredAgents.includes(agent.kind))
    .map((agent) => `${agent.kind}: readiness=${agent.readiness} credentialState=${agent.credentialState}${agent.message ? ` message=${agent.message}` : ""}`)
    .join("\n");

  throw new Error(
    `Timed out waiting for ready agents (${requiredAgents.join(", ")}).\n${summary}`,
  );
}

async function seedGeminiOauthCredentials() {
  const credsJson = process.env.GEMINI_OAUTH_CREDS_JSON?.trim();
  if (!credsJson) {
    return;
  }

  const geminiDir = join(homedir(), ".gemini");
  await mkdir(geminiDir, { recursive: true });
  await writeFile(
    join(geminiDir, "settings.json"),
    `${JSON.stringify({
      security: {
        auth: {
          selectedType: "oauth-personal",
        },
      },
    }, null, 2)}\n`,
  );
  await writeFile(join(geminiDir, "oauth_creds.json"), credsJson);
}

function buildTestEnv({
  baseUrl,
  authToken,
  workspacePath,
  readyAgentKinds,
  stateFile,
  fixtureRepoUrl,
  fixtureRepoRef,
}) {
  return {
    ANYHARNESS_TEST_BASE_URL: baseUrl,
    ANYHARNESS_TEST_AUTH_TOKEN: authToken,
    ANYHARNESS_TEST_WORKSPACE_PATH: workspacePath,
    ANYHARNESS_TEST_PATH_ACCESS: "local",
    ANYHARNESS_TEST_READY_AGENT_KINDS: readyAgentKinds.join(","),
    ANYHARNESS_TEST_RUNTIME_STATE_FILE: stateFile,
    ANYHARNESS_TEST_FIXTURE_REPO_URL: fixtureRepoUrl,
    ANYHARNESS_TEST_FIXTURE_REPO_REF: fixtureRepoRef,
  };
}

async function writeEnvFile(envFile, env) {
  await mkdir(path.dirname(envFile), { recursive: true });
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  await writeFile(envFile, `${lines.join("\n")}\n`);
}

function resolveFixtureRepoUrl() {
  const configured = process.env.ANYHARNESS_TEST_FIXTURE_REPO_URL?.trim();
  if (configured) {
    return configured;
  }

  const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "ignore"],
    env: process.env,
  }).toString().trim();

  if (!remote) {
    throw new Error("Unable to resolve fixture repo URL. Set ANYHARNESS_TEST_FIXTURE_REPO_URL.");
  }

  return remote;
}

function resolveGitHubToken() {
  const explicit = process.env.ANYHARNESS_TEST_GITHUB_TOKEN?.trim()
    || process.env.GITHUB_TOKEN?.trim()
    || process.env.GH_TOKEN?.trim();
  if (explicit) {
    return explicit;
  }

  if (!commandExists("gh")) {
    return null;
  }

  try {
    return execFileSync("gh", ["auth", "token"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      env: process.env,
    }).toString().trim() || null;
  } catch {
    return null;
  }
}

function normalizeAgents(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toGitHubRepoSlug(url) {
  const sshMatch = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  const parsed = new URL(url);
  return parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
}

function isGitHubRepoUrl(url) {
  return url.startsWith("git@github.com:") || url.startsWith("https://github.com/");
}

function normalizeFixtureCloneUrl(url, githubToken) {
  if (!(githubToken && isGitHubRepoUrl(url))) {
    return url;
  }

  return `https://github.com/${toGitHubRepoSlug(url)}.git`;
}

function buildGitHubAuthArgs(githubToken, fixtureRepoUrl) {
  if (!(githubToken && isGitHubRepoUrl(fixtureRepoUrl))) {
    return [];
  }

  const auth = Buffer.from(`x-access-token:${githubToken}`, "utf8").toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`];
}

function commandExists(command) {
  try {
    execFileSync("which", [command], {
      cwd: REPO_ROOT,
      stdio: "ignore",
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

async function stopProcess(pid) {
  if (!pid || !(await isProcessAlive(pid))) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await isProcessAlive(pid))) {
      return;
    }
    await delay(250);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
}

async function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readRuntimeLog(runtimeLogPath) {
  try {
    return await readFile(runtimeLogPath, "utf8");
  } catch {
    return "";
  }
}

async function getFreePort() {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCommandLine(argv) {
  const [command = "prepare", ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      "state-file": { type: "string" },
      "env-output-file": { type: "string" },
      "fixture-repo-url": { type: "string" },
      "fixture-repo-ref": { type: "string" },
      agents: { type: "string" },
      port: { type: "string" },
      "print-env": { type: "string" },
      "skip-ready-check": { type: "boolean" },
    },
    allowPositionals: true,
  });

  return {
    command,
    values,
  };
}

async function runCli(argv = process.argv.slice(2)) {
  const { command, values } = parseCommandLine(argv);

  if (command === "prepare") {
    const result = await prepareAgentRuntimeSuite({
      stateFile: values["state-file"],
      envFile: values["env-output-file"],
      fixtureRepoUrl: values["fixture-repo-url"],
      fixtureRepoRef: values["fixture-repo-ref"],
      requiredAgents: values.agents,
      port: values.port ? Number(values.port) : undefined,
      skipReadyCheck: values["skip-ready-check"],
    });

    if (values["print-env"] === "shell") {
      const shellLines = Object.entries(result.env).map(([key, value]) => `export ${key}=${shellEscape(value)}`);
      process.stdout.write(`${shellLines.join("\n")}\n`);
      return;
    }

    if (values["print-env"] === "dotenv") {
      const envLines = Object.entries(result.env).map(([key, value]) => `${key}=${value}`);
      process.stdout.write(`${envLines.join("\n")}\n`);
      return;
    }

    process.stdout.write(
      [
        "Prepared AnyHarness agent runtime test environment.",
        `stateFile: ${result.state.env.ANYHARNESS_TEST_RUNTIME_STATE_FILE}`,
        `baseUrl: ${result.state.baseUrl}`,
        `workspacePath: ${result.state.workspacePath}`,
        `runtimeLogPath: ${result.state.runtimeLogPath}`,
        `readyAgents: ${result.state.readyAgentKinds.join(",")}`,
      ].join("\n") + "\n",
    );
    return;
  }

  if (command === "cleanup") {
    const stateFile = values["state-file"] ?? process.env.ANYHARNESS_TEST_RUNTIME_STATE_FILE?.trim();
    if (!stateFile) {
      throw new Error("cleanup requires --state-file or ANYHARNESS_TEST_RUNTIME_STATE_FILE");
    }
    await cleanupAgentRuntimeSuite({ stateFile });
    process.stdout.write(`Cleaned up AnyHarness agent runtime test environment from ${stateFile}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
