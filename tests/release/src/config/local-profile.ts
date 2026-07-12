import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { TargetLane } from "./types.js";

export const PROFILE_VARIABLE = "RELEASE_E2E_PROFILE";
export const PROFILE_WORKTREE_MISMATCH_VARIABLE = "RELEASE_E2E_ALLOW_PROFILE_WORKTREE_MISMATCH";

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const GIT_HEAD_PATTERN = /^[0-9a-f]{40,64}$/i;
const BUILD_IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/i;

export interface ManagedDatabaseConnectionIdentity {
  host: string;
  port: number;
  user: string;
  database: string;
}

export interface CandidateBuildIdentity {
  gitHead: string;
  buildIdentity: string;
}

interface DevProfileInstance {
  profile?: string;
  worktreePath?: string;
  databaseName?: string;
  databaseMode?: "profile" | "external";
  singleOrgMode?: boolean;
  managedDatabaseConnection?: Partial<ManagedDatabaseConnectionIdentity>;
  managedDatabaseUsesDefaultPassword?: boolean;
  candidateGitHead?: string;
  candidateBuildIdentity?: string;
  publicCloudWorkerBaseUrl?: string;
  ports?: {
    api?: number;
    desktopWeb?: number;
    anyharness?: number;
  };
}

export interface LocalProfileLoadResult {
  profile: string;
  instancePath: string;
  worktreePath: string;
  databaseMode: "profile" | "external";
  singleOrgMode: boolean;
  managedDatabaseConnection?: Readonly<ManagedDatabaseConnectionIdentity>;
  managedDatabaseUsesDefaultPassword?: boolean;
  managedDatabaseUsesSafeDefaults?: boolean;
  requiresExplicitDatabaseUrl: boolean;
  candidateGitHead: string;
  candidateBuildIdentity: string;
  publicCloudWorkerBaseUrl?: string;
  appliedNames: readonly string[];
  preservedNames: readonly string[];
}

export interface LoadLocalProfileOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /**
   * Names present before a credential file was loaded. When supplied, these
   * are the only values treated as explicit overrides; profile-derived
   * endpoints replace stale endpoint defaults read from the shared file.
   */
  preserveNames?: ReadonlySet<string>;
  currentWorktreePath?: string;
  /** Test seam for synthetic worktrees; production resolves this from git. */
  profileCandidateIdentity?: CandidateBuildIdentity;
}

export class LocalProfileConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalProfileConfigurationError";
  }
}

/** A local profile must never redirect a staging-lane run to local endpoints. */
export function assertLocalProfileTargetLaneCompatibility(
  targetLane: TargetLane,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const profile = env[PROFILE_VARIABLE]?.trim();
  if (targetLane === "staging" && profile) {
    throw new LocalProfileConfigurationError(
      `${PROFILE_VARIABLE}=${profile} is a local full-stack profile and cannot be combined with ` +
        '--lane staging. Unset the profile for staging, or use --lane local.',
    );
  }
}

/**
 * Resolves a named full-stack dev profile into the release runner endpoints.
 * Ambient values win, making the profile a deterministic default rather than
 * an override of an explicitly supplied target.
 */
export function loadLocalProfileEnvironment(
  options: LoadLocalProfileOptions = {},
): LocalProfileLoadResult | undefined {
  const env = options.env ?? process.env;
  const profile = env[PROFILE_VARIABLE]?.trim();
  if (!profile) {
    return undefined;
  }
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new LocalProfileConfigurationError(
      `${PROFILE_VARIABLE} must contain only letters, numbers, underscores, or hyphens`,
    );
  }

  const homeDir = options.homeDir ?? homedir();
  const instancePath = path.join(
    homeDir,
    ".proliferate-local",
    "dev",
    "profiles",
    profile,
    "instance.json",
  );
  if (!existsSync(instancePath)) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" does not exist. Prepare it in this worktree with: make setup PROFILE=${profile}`,
    );
  }

  let instance: DevProfileInstance;
  try {
    instance = JSON.parse(readFileSync(instancePath, "utf8")) as DevProfileInstance;
  } catch (error) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" has an unreadable instance file (${instancePath}): ${errorMessage(error)}`,
    );
  }
  if (instance.profile !== profile) {
    throw new LocalProfileConfigurationError(
      `Dev profile instance mismatch: requested "${profile}", file declares "${instance.profile ?? "missing"}"`,
    );
  }
  const worktreePath = instance.worktreePath ? path.resolve(instance.worktreePath) : "";
  if (!worktreePath || !existsSync(worktreePath)) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" is stale: its bound worktree no longer exists (${worktreePath || "missing"}). ` +
        `Profiles are worktree-bound; prepare a fresh profile name in the clean worktree, for example: ` +
        `make setup PROFILE=${profile}-clean`,
    );
  }
  const canonicalProfileWorktree = realpathSync(worktreePath);
  const canonicalCurrentWorktree = realpathSync(
    options.currentWorktreePath ?? currentGitWorktree(process.cwd()),
  );
  const mismatchAuthorized =
    env[PROFILE_WORKTREE_MISMATCH_VARIABLE]?.trim() === "1" &&
    (!options.preserveNames || options.preserveNames.has(PROFILE_WORKTREE_MISMATCH_VARIABLE));
  if (canonicalProfileWorktree !== canonicalCurrentWorktree && !mismatchAuthorized) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" is bound to a different worktree (${canonicalProfileWorktree}); current candidate ` +
        `is ${canonicalCurrentWorktree}. Prepare a profile in this candidate worktree, or explicitly set ` +
        `${PROFILE_WORKTREE_MISMATCH_VARIABLE}=1 for an intentional cross-worktree target.`,
    );
  }

  if (instance.databaseMode !== "profile" && instance.databaseMode !== "external") {
    throw profileRefreshError(profile, "database-mode tracking");
  }
  if (typeof instance.singleOrgMode !== "boolean") {
    throw profileRefreshError(profile, "single-org posture tracking");
  }
  const candidateGitHead = validGitHead(instance.candidateGitHead, profile);
  const candidateBuildIdentity = validBuildIdentity(instance.candidateBuildIdentity, profile);
  const liveCandidate = options.profileCandidateIdentity
    ? validCandidateIdentity(options.profileCandidateIdentity, profile)
    : candidateGitIdentity(canonicalProfileWorktree);
  if (
    liveCandidate.gitHead !== candidateGitHead ||
    liveCandidate.buildIdentity !== candidateBuildIdentity
  ) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" is stale: its bound checkout changed after profile launch ` +
        `(recorded HEAD ${candidateGitHead}, current HEAD ${liveCandidate.gitHead}). ` +
        `Restart it with make run PROFILE=${profile} before collecting release evidence.`,
    );
  }

  const databaseName = validDatabaseName(instance.databaseName, profile);
  let managedDatabaseConnection: ManagedDatabaseConnectionIdentity | undefined;
  let managedDatabaseUsesDefaultPassword: boolean | undefined;
  let managedDatabaseUsesSafeDefaults: boolean | undefined;
  if (instance.databaseMode === "profile") {
    managedDatabaseConnection = validManagedDatabaseConnection(
      instance.managedDatabaseConnection,
      databaseName,
      profile,
    );
    if (typeof instance.managedDatabaseUsesDefaultPassword !== "boolean") {
      throw profileRefreshError(profile, "managed database credential-posture tracking");
    }
    managedDatabaseUsesDefaultPassword = instance.managedDatabaseUsesDefaultPassword;
    managedDatabaseUsesSafeDefaults = usesSafeManagedDatabaseDefaults(
      managedDatabaseConnection,
      profile,
      managedDatabaseUsesDefaultPassword,
    );
  } else if (
    instance.managedDatabaseConnection !== undefined ||
    instance.managedDatabaseUsesDefaultPassword !== undefined
  ) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" declares an external database but also includes managed connection metadata. ` +
        `Re-run make setup PROFILE=${profile} in its bound worktree.`,
    );
  }
  const requiresExplicitDatabaseUrl =
    instance.databaseMode === "external" || managedDatabaseUsesSafeDefaults === false;
  const publicCloudWorkerBaseUrl = validPublicCloudWorkerBaseUrl(
    instance.publicCloudWorkerBaseUrl,
    profile,
  );

  const apiPort = validPort(instance.ports?.api, "api", profile);
  const runtimePort = validPort(instance.ports?.anyharness, "anyharness", profile);
  const desktopWebPort = validPort(instance.ports?.desktopWeb, "desktopWeb", profile);
  const derived: Record<string, string> = {
    RELEASE_E2E_SERVER_URL: `http://127.0.0.1:${apiPort}`,
    RELEASE_E2E_LOCAL_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
    RELEASE_E2E_DESKTOP_WEB_URL: `http://127.0.0.1:${desktopWebPort}`,
    SETUP_TOKEN_FILE: path.join(path.dirname(instancePath), "setup-token"),
  };
  if (!isExplicitlyPresent("RELEASE_E2E_DURABLE_ORG_ID", env, options.preserveNames)) {
    // Organization ids are profile-database records. Never reuse a generic
    // dotenv value from another local profile; live local seeding resolves the
    // actual org id after claim/login.
    delete env.RELEASE_E2E_DURABLE_ORG_ID;
  }
  if (instance.databaseMode === "profile" && managedDatabaseUsesSafeDefaults) {
    const connection = managedDatabaseConnection as ManagedDatabaseConnectionIdentity;
    derived.RELEASE_E2E_LOCAL_DATABASE_URL =
      `postgresql+asyncpg://${encodeURIComponent(connection.user)}:localdev` +
      `@${bracketIpv6(connection.host)}:${connection.port}/${connection.database}`;
  } else if (!isExplicitlyPresent("RELEASE_E2E_LOCAL_DATABASE_URL", env, options.preserveNames)) {
    // A generic dotenv may carry an endpoint for another profile. External
    // databases and custom managed connections have no safe credential-bearing
    // URL to derive, so remove the file-sourced value. DB-dependent cells then
    // report RELEASE_E2E_LOCAL_DATABASE_URL as an explicit, lane-scoped gap.
    delete env.RELEASE_E2E_LOCAL_DATABASE_URL;
  }
  const appliedNames: string[] = [];
  const preservedNames: string[] = [];
  for (const [name, value] of Object.entries(derived)) {
    const explicitlyPresent = isExplicitlyPresent(name, env, options.preserveNames);
    if (explicitlyPresent) {
      preservedNames.push(name);
      continue;
    }
    env[name] = value;
    appliedNames.push(name);
  }

  return {
    profile,
    instancePath,
    worktreePath: canonicalProfileWorktree,
    databaseMode: instance.databaseMode,
    singleOrgMode: instance.singleOrgMode,
    managedDatabaseConnection,
    managedDatabaseUsesDefaultPassword,
    managedDatabaseUsesSafeDefaults,
    requiresExplicitDatabaseUrl,
    candidateGitHead,
    candidateBuildIdentity,
    publicCloudWorkerBaseUrl,
    appliedNames,
    preservedNames,
  };
}

function currentGitWorktree(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new LocalProfileConfigurationError(`Could not resolve the current git worktree from ${cwd}`);
  }
}

function candidateGitIdentity(worktreePath: string): CandidateBuildIdentity {
  try {
    const gitHead = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().toLowerCase();
    const trackedDiff = execFileSync(
      "git",
      ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--"],
      {
        cwd: worktreePath,
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const untrackedOutput = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      {
        cwd: worktreePath,
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const hash = createHash("sha256");
    hash.update("git-head\0");
    hash.update(gitHead);
    hash.update("\0tracked-diff\0");
    hash.update(trackedDiff);
    const untrackedPaths = untrackedOutput
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
    for (const relativePath of untrackedPaths) {
      const absolutePath = path.join(worktreePath, relativePath);
      const stat = lstatSync(absolutePath);
      hash.update("\0untracked-path\0");
      hash.update(relativePath);
      if (stat.isSymbolicLink()) {
        hash.update("\0symlink\0");
        hash.update(readlinkSync(absolutePath));
      } else if (stat.isFile()) {
        hash.update("\0file\0");
        hash.update(readFileSync(absolutePath));
      } else {
        hash.update(`\0mode:${stat.mode};size:${stat.size}\0`);
      }
    }
    return {
      gitHead: validGitHead(gitHead, "current checkout"),
      buildIdentity: `sha256:${hash.digest("hex")}`,
    };
  } catch (error) {
    if (error instanceof LocalProfileConfigurationError) {
      throw error;
    }
    throw new LocalProfileConfigurationError(
      `Could not compute candidate git/build identity for ${worktreePath}: ${errorMessage(error)}`,
    );
  }
}

function validCandidateIdentity(
  value: CandidateBuildIdentity,
  profile: string,
): CandidateBuildIdentity {
  return {
    gitHead: validGitHead(value.gitHead, profile),
    buildIdentity: validBuildIdentity(value.buildIdentity, profile),
  };
}

function validGitHead(value: string | undefined, profile: string): string {
  if (!value || !GIT_HEAD_PATTERN.test(value)) {
    throw profileRefreshError(profile, "candidate git HEAD tracking");
  }
  return value.toLowerCase();
}

function validBuildIdentity(value: string | undefined, profile: string): string {
  if (!value || !BUILD_IDENTITY_PATTERN.test(value)) {
    throw profileRefreshError(profile, "candidate build tracking");
  }
  return value.toLowerCase();
}

function validManagedDatabaseConnection(
  value: Partial<ManagedDatabaseConnectionIdentity> | undefined,
  databaseName: string,
  profile: string,
): ManagedDatabaseConnectionIdentity {
  if (!value || typeof value !== "object") {
    throw profileRefreshError(profile, "managed database connection tracking");
  }
  const host = normalizedPostgresHost(value.host);
  if (!host || /[\s/@?#]/.test(host)) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" has an invalid managed database host`,
    );
  }
  if (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65535) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" has an invalid managed database port`,
    );
  }
  if (!value.user || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value.user)) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" has an invalid managed database user`,
    );
  }
  if (value.database !== databaseName) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" database identity mismatch: instance databaseName is "${databaseName}" ` +
        `but managed connection metadata declares "${value.database ?? "missing"}"`,
    );
  }
  return {
    host,
    port: value.port as number,
    user: value.user,
    database: databaseName,
  };
}

function usesSafeManagedDatabaseDefaults(
  connection: ManagedDatabaseConnectionIdentity,
  profile: string,
  usesDefaultPassword: boolean,
): boolean {
  return (
    connection.host === defaultPostgresHost() &&
    connection.port === 5432 &&
    connection.user === "proliferate" &&
    connection.database === `proliferate_dev_${profile.replaceAll("-", "_")}` &&
    usesDefaultPassword
  );
}

function validPublicCloudWorkerBaseUrl(
  value: string | undefined,
  profile: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" has an invalid public Cloud worker callback URL`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    isLoopbackHostname(parsed.hostname)
  ) {
    throw new LocalProfileConfigurationError(
      `Dev profile "${profile}" has an invalid public Cloud worker callback URL`,
    );
  }
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value === "::1" ||
    value === "::" ||
    value === "0.0.0.0" ||
    value.startsWith("127.")
  );
}

function normalizedPostgresHost(value: string | undefined): string {
  const host = value?.trim() ?? "";
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function profileRefreshError(profile: string, tracking: string): LocalProfileConfigurationError {
  return new LocalProfileConfigurationError(
    `Dev profile "${profile}" predates ${tracking}. Re-run make setup PROFILE=${profile} in its ` +
      "bound worktree before using it for release evidence.",
  );
}

function isExplicitlyPresent(
  name: string,
  env: NodeJS.ProcessEnv,
  preserveNames: ReadonlySet<string> | undefined,
): boolean {
  return preserveNames
    ? preserveNames.has(name)
    : Object.prototype.hasOwnProperty.call(env, name);
}

function defaultPostgresHost(): string {
  return process.platform === "darwin" ? "::1" : "127.0.0.1";
}

function validPort(value: number | undefined, field: string, profile: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new LocalProfileConfigurationError(`Dev profile "${profile}" has an invalid ${field} port`);
  }
  return value as number;
}

function validDatabaseName(value: string | undefined, profile: string): string {
  if (!value || !/^[A-Za-z0-9_]+$/.test(value)) {
    throw new LocalProfileConfigurationError(`Dev profile "${profile}" has an invalid database name`);
  }
  return value;
}

function bracketIpv6(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
