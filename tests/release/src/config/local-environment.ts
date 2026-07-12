import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { envVarNames, findEnvVarSpec } from "./env-manifest.js";
import { RELEASE_POLICY_ENV } from "../runner/workflow-policy.js";

export const ENV_FILE_VARIABLE = "RELEASE_E2E_ENV_FILE";
export const DEFAULT_RELEASE_E2E_ENV_RELATIVE = ".proliferate-local/dev/release-e2e.env";

const ALLOWED_FILE_KEYS = new Set([...envVarNames(), RELEASE_POLICY_ENV]);

export interface ReleaseEnvironmentLoadResult {
  status: "loaded" | "missing" | "skipped-ci";
  filePath: string;
  explicitFile: boolean;
  loadedNames: readonly string[];
  preservedNames: readonly string[];
  /** Valid, unselected keys that were deliberately not materialized. */
  ignoredNames: readonly string[];
}

export interface LoadReleaseEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  uid?: number;
  /** When set, only these validated keys are copied into `env`. */
  allowedNames?: ReadonlySet<string>;
}

export class ReleaseEnvironmentFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseEnvironmentFileError";
  }
}

/**
 * Loads the local release runner's credential file as data, never as shell
 * source. Ambient variables win so callers can override one value without
 * mutating the shared file. CI only reads a file when explicitly requested.
 */
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

  if (!explicitFile && isCi(env)) {
    return {
      status: "skipped-ci",
      filePath,
      explicitFile,
      loadedNames: [],
      preservedNames: [],
      ignoredNames: [],
    };
  }

  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      if (explicitFile) {
        throw new ReleaseEnvironmentFileError(
          `${ENV_FILE_VARIABLE} points to a missing file: ${filePath}`,
        );
      }
      return {
        status: "missing",
        filePath,
        explicitFile,
        loadedNames: [],
        preservedNames: [],
        ignoredNames: [],
      };
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new ReleaseEnvironmentFileError(
      `Refusing to load release credentials through a symbolic link: ${filePath}`,
    );
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
    if (findEnvVarSpec(name)?.persistentFileAllowed === false) {
      throw new ReleaseEnvironmentFileError(
        `${filePath}: ${name} is a per-run authorization switch and must be supplied in the ambient ` +
          "environment, never the persistent credential file",
      );
    }
    if (!ALLOWED_FILE_KEYS.has(name)) {
      throw new ReleaseEnvironmentFileError(
        `${filePath}: ${name} is not declared by the release runner environment manifest`,
      );
    }
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

  return {
    status: "loaded",
    filePath,
    explicitFile,
    loadedNames,
    preservedNames,
    ignoredNames,
  };
}

/** Strict dotenv parser for the small, shell-compatible credential file. */
export function parseReleaseEnvironmentFile(contents: string, source = "release-e2e.env"): Map<string, string> {
  const parsed = new Map<string, string>();
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
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
    if (char === '"') {
      return { value, rest: raw.slice(index + 1) };
    }
    if (char !== "\\") {
      value += char;
      continue;
    }
    index += 1;
    if (index >= raw.length) {
      break;
    }
    const escaped = raw[index];
    value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
  }
  throw new ReleaseEnvironmentFileError(`${source}:${lineNumber}: unterminated double-quoted value`);
}

function onlyCommentAfter(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function expandHome(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return path.join(homeDir, value.slice(2));
  }
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
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
