/**
 * Secure local secret loading for the foundation runner.
 *
 * Loads `~/.proliferate-local/dev/release-e2e.env` (or an explicit file) as
 * DATA, never sourced as shell. Ambient environment wins: a value already set
 * in `env` is preserved, so an operator can override one credential without
 * editing the shared file. CI never reads a local file unless one is explicitly
 * requested. The file must be a regular, owner-only (mode & 0o077 === 0),
 * non-symlink file owned by the current uid.
 *
 * Ported and reduced from the combined worktree's config/local-environment.ts:
 * this variant has no dependency on any workstream's env manifest — the caller
 * supplies an optional allow-list of names.
 */

import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const ENV_FILE_VARIABLE = "RELEASE_E2E_ENV_FILE";
export const DEFAULT_RELEASE_E2E_ENV_RELATIVE = ".proliferate-local/dev/release-e2e.env";

export class ReleaseEnvironmentFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseEnvironmentFileError";
  }
}

export interface LoadReleaseEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  uid?: number;
  /** When set, only these keys are copied into `env`; others are ignored. */
  allowedNames?: ReadonlySet<string>;
  /** Overrides the CI detection for tests. */
  treatAsCi?: boolean;
}

export interface ReleaseEnvironmentLoadResult {
  status: "loaded" | "missing" | "skipped-ci";
  filePath: string;
  explicitFile: boolean;
  /** Names copied into env from the file (were previously unset). */
  loadedNames: readonly string[];
  /** Names present in the file but already set in env (ambient wins). */
  preservedNames: readonly string[];
  /** Valid names deliberately not materialized because they were not allow-listed. */
  ignoredNames: readonly string[];
}

export function loadReleaseEnvironment(
  options: LoadReleaseEnvironmentOptions = {},
): ReleaseEnvironmentLoadResult {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const explicitValue = nonEmpty(env[ENV_FILE_VARIABLE]);
  const explicitFile = explicitValue !== undefined;
  const filePath = explicitValue
    ? expandHome(explicitValue, homeDir)
    : path.join(homeDir, DEFAULT_RELEASE_E2E_ENV_RELATIVE);

  const ci = options.treatAsCi ?? isCi(env);
  if (!explicitFile && ci) {
    return { status: "skipped-ci", filePath, explicitFile, loadedNames: [], preservedNames: [], ignoredNames: [] };
  }

  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      if (explicitFile) {
        throw new ReleaseEnvironmentFileError(`${ENV_FILE_VARIABLE} points to a missing file: ${filePath}`);
      }
      return { status: "missing", filePath, explicitFile, loadedNames: [], preservedNames: [], ignoredNames: [] };
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new ReleaseEnvironmentFileError(`Refusing to load release credentials through a symbolic link: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new ReleaseEnvironmentFileError(`Release environment path is not a regular file: ${filePath}`);
  }
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  if (uid !== undefined && stats.uid !== uid) {
    throw new ReleaseEnvironmentFileError(
      `Release environment file must be owned by uid ${uid}: ${filePath} is owned by uid ${stats.uid}`,
    );
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new ReleaseEnvironmentFileError(
      `Release environment file permissions are too broad (${(stats.mode & 0o777)
        .toString(8)
        .padStart(3, "0")}): chmod 600 ${filePath}`,
    );
  }

  const parsed = parseReleaseEnvironmentFile(readFileSync(filePath, "utf8"), filePath);
  const loadedNames: string[] = [];
  const preservedNames: string[] = [];
  const ignoredNames: string[] = [];
  for (const [name, value] of parsed) {
    if (options.allowedNames && !options.allowedNames.has(name)) {
      ignoredNames.push(name);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      preservedNames.push(name);
      continue;
    }
    env[name] = value;
    loadedNames.push(name);
  }

  return { status: "loaded", filePath, explicitFile, loadedNames, preservedNames, ignoredNames };
}

/** Strict dotenv parser for the small, shell-compatible credential file. */
export function parseReleaseEnvironmentFile(contents: string, source = "release-e2e.env"): Map<string, string> {
  const parsed = new Map<string, string>();
  const lines = stripBom(contents).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      throw new ReleaseEnvironmentFileError(`${source}:${index + 1}: expected NAME=value or export NAME=value`);
    }
    const name = match[1];
    if (parsed.has(name)) {
      throw new ReleaseEnvironmentFileError(`${source}:${index + 1}: duplicate key ${name}`);
    }
    parsed.set(name, parseValue(match[2], source, index + 1));
  }
  return parsed;
}

function parseValue(raw: string, source: string, lineNumber: number): string {
  if (raw.startsWith("'")) {
    const closing = raw.indexOf("'", 1);
    if (closing < 0 || !onlyCommentAfter(raw.slice(closing + 1))) {
      throw new ReleaseEnvironmentFileError(`${source}:${lineNumber}: malformed single-quoted value`);
    }
    return raw.slice(1, closing);
  }
  if (raw.startsWith('"')) {
    const { value, rest } = parseDoubleQuoted(raw, source, lineNumber);
    if (!onlyCommentAfter(rest)) {
      throw new ReleaseEnvironmentFileError(`${source}:${lineNumber}: unexpected content after quoted value`);
    }
    return value;
  }
  return raw.replace(/\s+#.*$/, "").trim();
}

function parseDoubleQuoted(raw: string, source: string, lineNumber: number): { value: string; rest: string } {
  let value = "";
  for (let index = 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') return { value, rest: raw.slice(index + 1) };
    if (char !== "\\") {
      value += char;
      continue;
    }
    index += 1;
    if (index >= raw.length) break;
    const escaped = raw[index];
    value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
  }
  throw new ReleaseEnvironmentFileError(`${source}:${lineNumber}: unterminated double-quoted value`);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function onlyCommentAfter(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function expandHome(value: string, homeDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return path.resolve(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isCi(env: NodeJS.ProcessEnv): boolean {
  return env.CI === "true" || env.CI === "1" || env.GITHUB_ACTIONS === "true" || env.GITHUB_ACTIONS === "1";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
