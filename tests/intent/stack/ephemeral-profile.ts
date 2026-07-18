import { createHash, randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MAX_PROFILE_LENGTH = 40;
const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const LOCAL_RUN_SCOPE = `local-${process.pid}-${randomUUID()}`;

export interface OwnedEphemeralProfile {
  readonly profile: string;
  readonly setupTokenFile: string;
  readonly databaseName: string;
  readonly profileDirectory: string;
  readonly runtimeDirectory: string;
  readonly desktopDirectory: string;
}

export type OwnedProfileResources = OwnedEphemeralProfile;

export interface OwnedProfileRoots {
  profileRoot: string;
  runtimeRoot: string;
  tempRoot: string;
}

export interface OwnedProfileLifecycle {
  pathExists: (target: string) => boolean;
  databaseExists: (databaseName: string) => boolean;
  dropDatabase: (databaseName: string) => void;
  removeFile: (target: string) => void;
  removeDirectory: (target: string) => void;
}

function defaultRoots(): OwnedProfileRoots {
  return {
    profileRoot: path.join(homedir(), ".proliferate-local", "dev", "profiles"),
    runtimeRoot: path.join(homedir(), ".proliferate-local", "runtimes"),
    tempRoot: "/tmp",
  };
}

function normalizeFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "") || "run";
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function shortCoordinate(value: number): string {
  return value.toString(36).slice(-3);
}

function profileName(
  namespace: string,
  runId: string,
  runAttempt: number,
  workerIndex: number,
  retry: number,
): string {
  const normalizedNamespace = normalizeFragment(namespace);
  const normalizedRunId = normalizeFragment(runId);
  const coordinates = [
    `a${shortCoordinate(runAttempt)}`,
    `w${shortCoordinate(workerIndex)}`,
    `r${shortCoordinate(retry)}`,
  ].join("");
  const digest = createHash("sha256")
    .update(`${namespace}\0${runId}\0${runAttempt}\0${workerIndex}\0${retry}`)
    .digest("hex")
    .slice(0, 8);
  const suffix = `${normalizedRunId.slice(-8)}-${coordinates}-${digest}`;
  const namespaceBudget = MAX_PROFILE_LENGTH - suffix.length - 1;
  const boundedNamespace = normalizedNamespace.slice(0, Math.max(1, namespaceBudget));
  return `${boundedNamespace}-${suffix}`;
}

export function setupTokenFileForProfile(profile: string, tempRoot = "/tmp"): string {
  return path.join(tempRoot, `proliferate-${profile}-setup-token`);
}

export function createOwnedEphemeralProfile(options: {
  namespace: string;
  runId: string;
  runAttempt: number;
  workerIndex: number;
  retry: number;
  roots?: OwnedProfileRoots;
}): OwnedEphemeralProfile {
  const runAttempt = nonnegativeInteger(options.runAttempt, "run attempt");
  const workerIndex = nonnegativeInteger(options.workerIndex, "worker index");
  const retry = nonnegativeInteger(options.retry, "retry");
  if (!options.runId.trim()) {
    throw new Error("run id must not be empty.");
  }
  const roots = options.roots ?? defaultRoots();
  const profile = profileName(options.namespace, options.runId, runAttempt, workerIndex, retry);
  if (!PROFILE_PATTERN.test(profile)) {
    throw new Error(`Derived profile name is invalid: ${profile}`);
  }
  const profileDirectory = path.join(roots.profileRoot, profile);
  return Object.freeze({
    profile,
    setupTokenFile: setupTokenFileForProfile(profile, roots.tempRoot),
    databaseName: `proliferate_dev_${profile.replaceAll("-", "_")}`,
    profileDirectory,
    runtimeDirectory: path.join(roots.runtimeRoot, profile),
    desktopDirectory: path.join(profileDirectory, "app"),
  });
}

export function ownedEphemeralProfileForWorker(options: {
  namespace: string;
  workerIndex: number;
  retry: number;
  env?: NodeJS.ProcessEnv;
  localRunScope?: string;
}): OwnedEphemeralProfile {
  const env = options.env ?? process.env;
  const runId = env.GITHUB_RUN_ID
    ? `gh-${env.GITHUB_RUN_ID}`
    : env.TIER2_INTENT_RUN_SCOPE || options.localRunScope || LOCAL_RUN_SCOPE;
  const rawAttempt = env.GITHUB_RUN_ATTEMPT ?? "1";
  if (!/^\d+$/.test(rawAttempt)) {
    throw new Error("GITHUB_RUN_ATTEMPT must be a non-negative integer.");
  }
  return createOwnedEphemeralProfile({
    namespace: options.namespace,
    runId,
    runAttempt: Number(rawAttempt),
    workerIndex: options.workerIndex,
    retry: options.retry,
  });
}

function runPsql(sql: string): string {
  const result = spawnSync(
    "psql",
    [
      "-h",
      process.env.LOCAL_PGHOST || "127.0.0.1",
      "-p",
      process.env.LOCAL_PGPORT || "5432",
      "-U",
      process.env.LOCAL_PGUSER || "proliferate",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-c",
      sql,
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: process.env.LOCAL_PGPASSWORD || "localdev",
      },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown psql error").trim();
    throw new Error(`Owned profile database operation failed: ${detail}`);
  }
  return result.stdout.trim();
}

const defaultLifecycle: OwnedProfileLifecycle = {
  pathExists: existsSync,
  databaseExists: (databaseName) => (
    runPsql(`SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`) === "1"
  ),
  dropDatabase: (databaseName) => {
    runPsql(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  },
  removeFile: (target) => rmSync(target, { force: true }),
  removeDirectory: (target) => rmSync(target, { force: true, recursive: true }),
};

function assertOwnedProfileShape(owned: OwnedEphemeralProfile): void {
  if (!PROFILE_PATTERN.test(owned.profile)) {
    throw new Error("Owned profile name is invalid.");
  }
  const expectedDatabase = `proliferate_dev_${owned.profile.replaceAll("-", "_")}`;
  const expectedToken = `proliferate-${owned.profile}-setup-token`;
  if (
    owned.databaseName !== expectedDatabase
    || path.basename(owned.setupTokenFile) !== expectedToken
    || path.basename(owned.profileDirectory) !== owned.profile
    || path.basename(owned.runtimeDirectory) !== owned.profile
    || path.resolve(owned.desktopDirectory) !== path.resolve(owned.profileDirectory, "app")
  ) {
    throw new Error("Owned profile paths do not match its identity.");
  }
}

export function prepareOwnedEphemeralProfile(
  owned: OwnedEphemeralProfile,
  lifecycle: OwnedProfileLifecycle = defaultLifecycle,
): void {
  assertOwnedProfileShape(owned);
  const collisions = [
    ["setup token", lifecycle.pathExists(owned.setupTokenFile)],
    ["profile directory", lifecycle.pathExists(owned.profileDirectory)],
    ["runtime directory", lifecycle.pathExists(owned.runtimeDirectory)],
    ["database", lifecycle.databaseExists(owned.databaseName)],
  ].filter(([, exists]) => exists).map(([label]) => label);
  if (collisions.length > 0) {
    throw new Error(`Owned ephemeral profile is not fresh (${collisions.join(", ")}).`);
  }
}

export function assertOwnedProfileResources(
  owned: OwnedEphemeralProfile,
  resources: OwnedProfileResources,
): void {
  assertOwnedProfileShape(owned);
  if (resources.profile !== owned.profile || resources.databaseName !== owned.databaseName) {
    throw new Error("Owned profile resource identity does not match.");
  }
  for (const key of ["setupTokenFile", "profileDirectory", "runtimeDirectory", "desktopDirectory"] as const) {
    if (path.resolve(resources[key]) !== path.resolve(owned[key])) {
      throw new Error(`Owned profile resource mismatch: ${key}.`);
    }
  }
}

export function cleanupOwnedEphemeralProfile(
  owned: OwnedEphemeralProfile,
  resources: OwnedProfileResources,
  lifecycle: OwnedProfileLifecycle = defaultLifecycle,
): void {
  assertOwnedProfileResources(owned, resources);
  const failures: unknown[] = [];
  for (const operation of [
    () => lifecycle.dropDatabase(owned.databaseName),
    () => lifecycle.removeFile(owned.setupTokenFile),
    () => lifecycle.removeDirectory(owned.runtimeDirectory),
    () => lifecycle.removeDirectory(owned.profileDirectory),
  ]) {
    try {
      operation();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Owned ephemeral profile cleanup failed.");
  }
}
