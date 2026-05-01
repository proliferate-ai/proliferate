#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devRoot = path.join(homedir(), ".proliferate-local", "dev");
const profilesRoot = path.join(devRoot, "profiles");
const portsLockPath = path.join(devRoot, "ports.lock");
const lockStaleMs = 2 * 60 * 1000;

const persistedKeys = [
  "PROLIFERATE_DEV_PROFILE",
  "PROLIFERATE_API_PORT",
  "PROLIFERATE_WEB_PORT",
  "PROLIFERATE_WEB_HMR_PORT",
  "ANYHARNESS_PORT",
  "ANYHARNESS_RUNTIME_HOME",
  "PROLIFERATE_DEV_HOME",
  "PROLIFERATE_DEV_DB_NAME",
];

const portKeys = [
  ["PROLIFERATE_API_PORT", 8000],
  ["PROLIFERATE_WEB_PORT", 1420],
  ["PROLIFERATE_WEB_HMR_PORT", 1421],
  ["ANYHARNESS_PORT", 8457],
];

function usage() {
  console.error(`Usage:
  node scripts/dev.mjs ensure --profile <name> [--lock]
  node scripts/dev.mjs list
  node scripts/dev.mjs database-url --db-name <name>
  node scripts/dev.mjs ensure-db --db-name <name>`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, lock: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--lock") {
      options.lock = true;
    } else if (arg === "--profile") {
      options.profile = rest[++i];
    } else if (arg === "--db-name") {
      options.dbName = rest[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function validateProfile(profile) {
  if (!profile || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(profile)) {
    throw new Error("PROFILE must match /^[a-z0-9][a-z0-9_-]{0,39}$/.");
  }
  return profile;
}

function validateDbName(dbName) {
  if (!dbName || !/^[a-z][a-z0-9_]{0,62}$/.test(dbName)) {
    throw new Error(`Invalid Postgres database name: ${dbName}`);
  }
  return dbName;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function unquoteShellValue(raw) {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("'\\''", "'");
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replaceAll("\\\"", "\"");
  }
  return value;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const env = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (match) {
      env[match[1]] = unquoteShellValue(match[2]);
    }
  }
  return env;
}

function writeEnvFile(filePath, values, mode = 0o644) {
  const lines = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`);
  writeFileAtomic(filePath, `${lines.join("\n")}\n`);
  chmodSync(filePath, mode);
}

function writeFileAtomic(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tempPath, contents, "utf8");
  renameSync(tempPath, filePath);
}

function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function gitBranch(worktreePath) {
  try {
    return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktreePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not determine git branch for ${worktreePath}: ${message}`);
    return "unknown";
  }
}

function profileDir(profile) {
  return path.join(profilesRoot, profile);
}

function profilePaths(profile) {
  const root = profileDir(profile);
  return {
    root,
    profileEnv: path.join(root, "profile.env"),
    launchEnv: path.join(root, "launch.env"),
    tauriConfig: path.join(root, "tauri.dev.json"),
    tauriRunner: path.join(root, "tauri-runner.sh"),
    tauriAppRunner: path.join(root, "tauri-app-runner.sh"),
    instance: path.join(root, "instance.json"),
    runLock: path.join(root, "run.lock"),
    appHome: path.join(root, "app"),
    runtimeHome: path.join(homedir(), ".proliferate-local", "runtimes", profile),
  };
}

function dbNameForProfile(profile) {
  return `proliferate_dev_${profile.replaceAll("-", "_")}`;
}

function hostForUrl(host) {
  const value = host.trim();
  if (value.includes(":") && !value.startsWith("[") && !value.endsWith("]")) {
    return `[${value}]`;
  }
  return value;
}

function displayNameForProfile(profile) {
  return `Proliferate (${profile})`;
}

function tcpPortIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 250 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickPort(preferred, reservedPorts) {
  for (let port = preferred; port < 65535; port += 1) {
    if (reservedPorts.has(port)) {
      continue;
    }
    if (await canBindPort(port)) {
      reservedPorts.add(port);
      return port;
    }
  }
  throw new Error(`No free port found at or above ${preferred}.`);
}

function profileEnvFiles() {
  if (!existsSync(profilesRoot)) {
    return [];
  }
  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(profilesRoot, entry.name, "profile.env"))
    .filter((filePath) => existsSync(filePath));
}

function usedPortsExcept(profile) {
  const ports = new Set();
  for (const filePath of profileEnvFiles()) {
    const existingProfile = path.basename(path.dirname(filePath));
    if (existingProfile === profile) {
      continue;
    }
    const env = readEnvFile(filePath);
    for (const [key] of portKeys) {
      const port = Number(env[key]);
      if (Number.isInteger(port)) {
        ports.add(port);
      }
    }
  }
  return ports;
}

function ensureDbNameIsUnique(profile, dbName) {
  for (const filePath of profileEnvFiles()) {
    const existingProfile = path.basename(path.dirname(filePath));
    if (existingProfile === profile) {
      continue;
    }
    const env = readEnvFile(filePath);
    if (env.PROLIFERATE_DEV_DB_NAME === dbName) {
      throw new Error(
        `Profile "${profile}" would reuse database "${dbName}" already assigned to "${existingProfile}".`,
      );
    }
  }
}

function envOverride(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parsePort(name, value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port number.`);
  }
  return String(port);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockTimestampMs(lockPath) {
  const ownerPath = path.join(lockPath, "owner.json");
  try {
    return statSync(existsSync(ownerPath) ? ownerPath : lockPath).mtimeMs;
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function acquireDirectoryLock(lockPath) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      mkdirSync(lockPath);
      writeJsonAtomic(path.join(lockPath, "owner.json"), {
        pid: process.pid,
        createdAt: new Date().toISOString(),
      });
      return () => rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      const ageMs = Date.now() - lockTimestampMs(lockPath);
      if (ageMs > lockStaleMs) {
        rmSync(lockPath, { recursive: true, force: true });
      } else if (attempt === 7) {
        throw new Error(`Lock is active: ${lockPath}`);
      } else {
        await sleep(25 + Math.floor(Math.random() * 75));
      }
    }
  }
  throw new Error(`Lock is active: ${lockPath}`);
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function staleRunLock(paths, env) {
  if (!existsSync(paths.runLock)) {
    return true;
  }
  const activePorts = await Promise.all(
    portKeys.map(([key]) => tcpPortIsOpen(Number(env[key]))),
  );
  if (activePorts.some(Boolean)) {
    return false;
  }
  const ageMs = Date.now() - statSync(paths.runLock).mtimeMs;
  return ageMs > lockStaleMs;
}

async function ensureRunLock(paths, env, worktreePath) {
  if (existsSync(paths.runLock)) {
    if (!(await staleRunLock(paths, env))) {
      throw new Error(`Profile appears to be running or launching: ${paths.runLock}`);
    }
    rmSync(paths.runLock, { force: true });
  }
  writeJsonAtomic(paths.runLock, {
    pid: process.pid,
    worktreePath,
    createdAt: new Date().toISOString(),
  });
  return paths.runLock;
}

async function resolveProfileEnv(profile, paths) {
  let persisted = readEnvFile(paths.profileEnv);
  const missingPersisted = persistedKeys.some((key) => !persisted[key]);
  if (Object.keys(persisted).length === 0 || missingPersisted) {
    const releaseLock = await acquireDirectoryLock(portsLockPath);
    try {
      const reserved = usedPortsExcept(profile);
      const allocated = {
        PROLIFERATE_DEV_PROFILE: profile,
        ANYHARNESS_RUNTIME_HOME: persisted.ANYHARNESS_RUNTIME_HOME ?? paths.runtimeHome,
        PROLIFERATE_DEV_HOME: persisted.PROLIFERATE_DEV_HOME ?? paths.appHome,
        PROLIFERATE_DEV_DB_NAME: persisted.PROLIFERATE_DEV_DB_NAME ?? dbNameForProfile(profile),
      };
      for (const [key, preferred] of portKeys) {
        allocated[key] = persisted[key] ?? String(await pickPort(preferred, reserved));
      }
      writeEnvFile(paths.profileEnv, orderedEnv(allocated, persistedKeys));
      persisted = allocated;
    } finally {
      releaseLock();
    }
  }

  const effective = { ...persisted };
  for (const [key] of portKeys) {
    const override = envOverride(key);
    if (override) {
      effective[key] = parsePort(key, override);
    }
  }
  for (const key of [
    "ANYHARNESS_RUNTIME_HOME",
    "PROLIFERATE_DEV_HOME",
    "PROLIFERATE_DEV_DB_NAME",
  ]) {
    const override = envOverride(key);
    if (override) {
      effective[key] = override;
    }
  }
  effective.PROLIFERATE_DEV_PROFILE = profile;
  validateDbName(effective.PROLIFERATE_DEV_DB_NAME);
  ensureDbNameIsUnique(profile, effective.PROLIFERATE_DEV_DB_NAME);
  return effective;
}

function orderedEnv(values, keys) {
  const ordered = {};
  for (const key of keys) {
    if (values[key] !== undefined) {
      ordered[key] = values[key];
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (!(key in ordered)) {
      ordered[key] = value;
    }
  }
  return ordered;
}

function ensureProfileBound(profile, paths, worktreePath, branch) {
  const existing = readJsonFile(paths.instance);
  if (existing?.worktreePath && path.resolve(existing.worktreePath) !== worktreePath) {
    throw new Error(
      `Profile "${profile}" is already bound to ${existing.worktreePath}; current worktree is ${worktreePath}.`,
    );
  }
  const next = {
    ...(existing ?? {}),
    profile,
    worktreePath,
    branch,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(paths.instance, next);
}

function generatedTauriConfig(profile, env) {
  const basePath = path.join(repoRoot, "desktop", "src-tauri", "tauri.dev.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  const identifierSlug = profile.replaceAll("_", "-");
  const displayName = displayNameForProfile(profile);
  return {
    ...base,
    productName: displayName,
    identifier: `com.proliferate.app.local.${identifierSlug}`,
    build: {
      devUrl: `http://127.0.0.1:${env.PROLIFERATE_WEB_PORT}`,
    },
    app: {
      ...(base.app ?? {}),
      windows: [
        {
          ...(base.app?.windows?.[0] ?? {}),
          title: displayName,
        },
      ],
    },
  };
}

function writeTauriRunner(profile, paths) {
  const displayName = displayNameForProfile(profile);
  const appRunner = `#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Tauri app runner expected the built executable path as argv[1]." >&2
  exit 64
fi

built_executable="$1"
shift

runner_dir="$(dirname "$0")/bin"
mkdir -p "$runner_dir"
profile_executable="$runner_dir/${displayName}"

cp "$built_executable" "$profile_executable"
chmod +x "$profile_executable"
exec "$profile_executable" "$@"
`;
  const cargoRunner = `#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
app_runner="$script_dir/tauri-app-runner.sh"

export CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER="$app_runner"
export CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER="$app_runner"

exec cargo "$@"
`;
  writeFileAtomic(paths.tauriAppRunner, appRunner);
  chmodSync(paths.tauriAppRunner, 0o755);
  writeFileAtomic(paths.tauriRunner, cargoRunner);
  chmodSync(paths.tauriRunner, 0o755);
}

function writeLaunchEnv(paths, env) {
  const launchEnv = {
    PROLIFERATE_DEV: "1",
    DEBUG: "true",
    ...orderedEnv(env, persistedKeys),
    ANYHARNESS_DEV_URL: `http://127.0.0.1:${env.ANYHARNESS_PORT}`,
    VITE_PROLIFERATE_API_BASE_URL: `http://127.0.0.1:${env.PROLIFERATE_API_PORT}`,
    API_BASE_URL: `http://127.0.0.1:${env.PROLIFERATE_API_PORT}`,
    CORS_ALLOW_ORIGINS: [
      `http://localhost:${env.PROLIFERATE_WEB_PORT}`,
      `http://127.0.0.1:${env.PROLIFERATE_WEB_PORT}`,
      "http://tauri.localhost",
      "tauri://localhost",
    ].join(","),
  };
  writeEnvFile(paths.launchEnv, launchEnv, 0o600);
}

async function ensureProfile(options) {
  const profile = validateProfile(options.profile);
  const paths = profilePaths(profile);
  const worktreePath = path.resolve(process.cwd());
  const branch = gitBranch(worktreePath);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.appHome, { recursive: true });
  mkdirSync(paths.runtimeHome, { recursive: true });

  const env = await resolveProfileEnv(profile, paths);
  ensureProfileBound(profile, paths, worktreePath, branch);
  writeJsonAtomic(paths.tauriConfig, generatedTauriConfig(profile, env));
  writeTauriRunner(profile, paths);
  writeLaunchEnv(paths, env);

  const instance = {
    profile,
    worktreePath,
    branch,
    profileEnv: paths.profileEnv,
    launchEnv: paths.launchEnv,
    tauriConfig: paths.tauriConfig,
    tauriRunner: paths.tauriRunner,
    tauriAppRunner: paths.tauriAppRunner,
    anyharnessRuntimeHome: env.ANYHARNESS_RUNTIME_HOME,
    desktopHome: env.PROLIFERATE_DEV_HOME,
    databaseName: env.PROLIFERATE_DEV_DB_NAME,
    ports: {
      api: Number(env.PROLIFERATE_API_PORT),
      web: Number(env.PROLIFERATE_WEB_PORT),
      hmr: Number(env.PROLIFERATE_WEB_HMR_PORT),
      anyharness: Number(env.ANYHARNESS_PORT),
    },
    updatedAt: new Date().toISOString(),
    status: options.lock ? "launching" : "prepared",
  };

  let runLock = null;
  try {
    if (options.lock) {
      runLock = await ensureRunLock(paths, env, worktreePath);
    }
    writeJsonAtomic(paths.instance, instance);
  } catch (error) {
    if (runLock) {
      rmSync(runLock, { force: true });
    }
    throw error;
  }
  console.error(`Prepared dev profile "${profile}" at ${paths.root}`);
  console.log(paths.launchEnv);
}

function dbUrlFor(dbName) {
  validateDbName(dbName);
  const host = hostForUrl(process.env.LOCAL_PGHOST || "127.0.0.1");
  const port = process.env.LOCAL_PGPORT || "5432";
  const user = process.env.LOCAL_PGUSER || "proliferate";
  const password = process.env.LOCAL_PGPASSWORD || "localdev";
  return `postgresql+asyncpg://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
}

function psqlArgsFor(sql) {
  return [
    "-U",
    process.env.LOCAL_PGUSER || "proliferate",
    "-d",
    "postgres",
    "-c",
    sql,
  ];
}

function ensureDatabase(dbName) {
  validateDbName(dbName);
  const sql = `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`;
  const createSql = `CREATE DATABASE "${dbName}" TEMPLATE template0`;
  const useExisting = process.env.USE_EXISTING_POSTGRES === "1";
  const baseEnv = { PGPASSWORD: process.env.LOCAL_PGPASSWORD || "localdev" };

  let existsOutput;
  if (useExisting) {
    existsOutput = run(
      "psql",
      [
        "-h",
        process.env.LOCAL_PGHOST || "127.0.0.1",
        "-p",
        process.env.LOCAL_PGPORT || "5432",
        ...psqlArgsFor(sql),
        "-tA",
      ],
      { env: baseEnv },
    );
  } else {
    existsOutput = run("docker", [
      "compose",
      "-f",
      "server/docker-compose.yml",
      "exec",
      "-T",
      "db",
      "psql",
      ...psqlArgsFor(sql),
      "-tA",
    ]);
  }

  if (existsOutput.trim() === "1") {
    console.error(`Postgres database "${dbName}" already exists.`);
    return;
  }

  if (useExisting) {
    run(
      "psql",
      [
        "-h",
        process.env.LOCAL_PGHOST || "127.0.0.1",
        "-p",
        process.env.LOCAL_PGPORT || "5432",
        ...psqlArgsFor(createSql),
      ],
      { env: baseEnv },
    );
  } else {
    run("docker", [
      "compose",
      "-f",
      "server/docker-compose.yml",
      "exec",
      "-T",
      "db",
      "psql",
      ...psqlArgsFor(createSql),
    ]);
  }
  console.error(`Created Postgres database "${dbName}".`);
}

function pad(value, width) {
  return String(value).padEnd(width, " ");
}

async function listProfiles() {
  if (!existsSync(profilesRoot)) {
    console.log("No dev profiles found.");
    return;
  }
  const rows = [];
  for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const profile = entry.name;
    const paths = profilePaths(profile);
    const env = readEnvFile(paths.profileEnv);
    const instance = readJsonFile(paths.instance) ?? {};
    const ports = {
      web: Number(env.PROLIFERATE_WEB_PORT),
      api: Number(env.PROLIFERATE_API_PORT),
      anyharness: Number(env.ANYHARNESS_PORT),
    };
    const checks = await Promise.all([
      tcpPortIsOpen(ports.web),
      tcpPortIsOpen(ports.api),
      tcpPortIsOpen(ports.anyharness),
    ]);
    const status = checks.every(Boolean)
      ? "running"
      : checks.some(Boolean)
        ? "partial"
        : "stale";
    rows.push({
      profile,
      worktree: instance.worktreePath ?? "",
      branch: instance.branch ?? "",
      web: ports.web || "",
      api: ports.api || "",
      anyharness: ports.anyharness || "",
      db: env.PROLIFERATE_DEV_DB_NAME ?? "",
      status,
    });
  }
  if (rows.length === 0) {
    console.log("No dev profiles found.");
    return;
  }

  const widths = {
    profile: Math.max(7, ...rows.map((row) => row.profile.length)),
    branch: Math.max(6, ...rows.map((row) => row.branch.length)),
    worktree: Math.max(8, ...rows.map((row) => row.worktree.length)),
  };
  console.log([
    pad("PROFILE", widths.profile),
    pad("BRANCH", widths.branch),
    pad("WEB", 6),
    pad("API", 6),
    pad("AH", 6),
    pad("STATUS", 8),
    pad("DB", 24),
    "WORKTREE",
  ].join("  "));
  for (const row of rows) {
    console.log([
      pad(row.profile, widths.profile),
      pad(row.branch, widths.branch),
      pad(row.web, 6),
      pad(row.api, 6),
      pad(row.anyharness, 6),
      pad(row.status, 8),
      pad(row.db, 24),
      row.worktree,
    ].join("  "));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "ensure" || options.command === "dev-init") {
    await ensureProfile(options);
  } else if (options.command === "list") {
    await listProfiles();
  } else if (options.command === "database-url") {
    console.log(dbUrlFor(options.dbName));
  } else if (options.command === "ensure-db") {
    ensureDatabase(options.dbName);
  } else {
    usage();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
