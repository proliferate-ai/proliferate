/**
 * Secure local env-file loading.
 *
 * Parses `~/.proliferate-local/dev/release-e2e.env` (and, secondarily,
 * `server/.env`) as DATA — plain `[export ]NAME=value` lines. Never shell
 * `source`'d, so `$VAR` expansion, command substitution, and arbitrary shell
 * syntax are inert text, not executed. Ambient `process.env` always wins
 * over a file value, so an operator can override one credential without
 * editing the shared file. Nothing here ever returns, logs, or throws an
 * error containing a parsed VALUE — only names, line numbers, and structural
 * complaints reach any string this module produces.
 */

import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export class EnvFileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvFileParseError";
  }
}

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Parses `KEY=value` lines. Supports `#` comments, blank lines, optional
 * `export ` prefix, and single/double-quoted values (CRLF- and
 * BOM-tolerant). Double-quoted values support the same narrow backslash
 * escapes dotenv-style files conventionally use (`\n`, `\r`, `\t`, `\"`,
 * `\\`) — never `$VAR` expansion or command substitution, which are left as
 * literal characters. Throws `EnvFileParseError` (naming the source label
 * and line number, never the offending value) on a malformed line or a
 * duplicate key.
 */
export function parseEnvFileContents(contents: string, sourceLabel = "<env-file>"): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const lines = contents.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      return;
    }
    const match = ASSIGNMENT.exec(line);
    if (!match) {
      throw new EnvFileParseError(
        `${sourceLabel}:${lineNo}: expected NAME=value (optionally "export NAME=value")`,
      );
    }
    const [, name, rawValue] = match;
    if (values.has(name)) {
      throw new EnvFileParseError(`${sourceLabel}:${lineNo}: duplicate key "${name}"`);
    }
    values.set(name, parseScalarValue(rawValue, sourceLabel, lineNo));
  });
  return values;
}

function parseScalarValue(raw: string, sourceLabel: string, lineNo: number): string {
  if (raw.startsWith("'")) {
    const end = raw.indexOf("'", 1);
    if (end < 0 || !isCommentOrEmpty(raw.slice(end + 1))) {
      throw new EnvFileParseError(`${sourceLabel}:${lineNo}: unterminated or malformed single-quoted value`);
    }
    return raw.slice(1, end); // single quotes: no escapes, no expansion, verbatim.
  }
  if (raw.startsWith('"')) {
    const { value, rest } = readDoubleQuoted(raw, sourceLabel, lineNo);
    if (!isCommentOrEmpty(rest)) {
      throw new EnvFileParseError(`${sourceLabel}:${lineNo}: unexpected content after the closing quote`);
    }
    return value;
  }
  // Unquoted: strip a trailing " #comment" and surrounding whitespace. Every
  // remaining character is taken literally — no `$VAR`, no backticks.
  return raw.replace(/\s+#.*$/, "").trim();
}

function readDoubleQuoted(raw: string, sourceLabel: string, lineNo: number): { value: string; rest: string } {
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
  throw new EnvFileParseError(`${sourceLabel}:${lineNo}: unterminated double-quoted value`);
}

function isCommentOrEmpty(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

export type EnvFileStatus = "loaded" | "missing" | "not-a-file";

export interface EnvFileSource {
  readonly label: string;
  readonly path: string;
  readonly status: EnvFileStatus;
  /** Key names found in the file — never their values. */
  readonly names: readonly string[];
  /** Non-fatal note about file permissions/ownership, or null when unremarkable. */
  readonly permissionsWarning: string | null;
}

/**
 * Reads and parses one env file. Missing files (and, for the optional
 * secondary source, anything that is not a regular file) are reported as a
 * status rather than thrown, since callers legitimately run with the file
 * absent. Only `EnvFileParseError` (malformed contents) propagates.
 */
export function readEnvFileSource(filePath: string, label: string): { source: EnvFileSource; values: ReadonlyMap<string, string> } {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        source: { label, path: filePath, status: "missing", names: [], permissionsWarning: null },
        values: new Map(),
      };
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    return {
      source: {
        label,
        path: filePath,
        status: "not-a-file",
        names: [],
        permissionsWarning: "refusing to read a symbolic link for a credential file",
      },
      values: new Map(),
    };
  }
  if (!stats.isFile()) {
    return { source: { label, path: filePath, status: "not-a-file", names: [], permissionsWarning: null }, values: new Map() };
  }

  const permissionsWarning = describePermissionsWarning(stats.mode);
  const contents = readFileSync(filePath, "utf8");
  const values = parseEnvFileContents(contents, filePath);
  return {
    source: { label, path: filePath, status: "loaded", names: [...values.keys()], permissionsWarning },
    values,
  };
}

function describePermissionsWarning(mode: number): string | null {
  if ((mode & 0o077) !== 0) {
    return `file permissions ${(mode & 0o777).toString(8).padStart(3, "0")} are group/world-accessible; recommended: chmod 600`;
  }
  return null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export const DEFAULT_RELEASE_E2E_ENV_RELATIVE = ".proliferate-local/dev/release-e2e.env";

export interface LoadLocalEnvironmentOptions {
  readonly ambient?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  /** Override for tests; defaults to `~/.proliferate-local/dev/release-e2e.env`. */
  readonly releaseEnvPath?: string;
  /** Override for tests; defaults to `<repoRoot>/server/.env` when `repoRoot` is given. */
  readonly serverEnvPath?: string;
  readonly repoRoot?: string;
}

export interface LocalEnvironment {
  readonly sources: readonly EnvFileSource[];
  /**
   * Resolves one name: ambient wins; falls back to release-e2e.env, then
   * server/.env. Returns `undefined` (never throws) when absent everywhere.
   * The caller decides whether that is fatal.
   */
  resolve(name: string): string | undefined;
  present(name: string): boolean;
  /** Union of every name any source could resolve — names only, for reporting. */
  knownNames(): readonly string[];
}

/**
 * Loads the local credential file(s) as data and returns an ambient-wins
 * resolver. Additional provider credentials that may exist in `server/.env`
 * are a secondary, lower-priority source (release-e2e.env > server/.env),
 * so a value explicitly set for the release runner is never shadowed by a
 * broader dev-server default of the same name.
 */
export function loadLocalEnvironment(options: LoadLocalEnvironmentOptions = {}): LocalEnvironment {
  const ambient = options.ambient ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const releasePath = options.releaseEnvPath ?? path.join(homeDir, DEFAULT_RELEASE_E2E_ENV_RELATIVE);

  const release = readEnvFileSource(releasePath, "release-e2e-env-file");

  let server: { source: EnvFileSource; values: ReadonlyMap<string, string> } | null = null;
  const serverPath = options.serverEnvPath ?? (options.repoRoot ? path.join(options.repoRoot, "server/.env") : undefined);
  if (serverPath) {
    server = readEnvFileSource(serverPath, "server-env-file");
  }

  const sources = server ? [release.source, server.source] : [release.source];

  const resolve = (name: string): string | undefined => {
    const ambientValue = nonEmpty(ambient[name]);
    if (ambientValue !== undefined) {
      return ambientValue;
    }
    const releaseValue = release.values.get(name);
    if (releaseValue !== undefined && releaseValue.length > 0) {
      return releaseValue;
    }
    const serverValue = server?.values.get(name);
    return serverValue !== undefined && serverValue.length > 0 ? serverValue : undefined;
  };

  return {
    sources,
    resolve,
    present: (name: string): boolean => resolve(name) !== undefined,
    knownNames: (): readonly string[] => {
      const names = new Set<string>([...release.values.keys(), ...(server?.values.keys() ?? [])]);
      return [...names].sort();
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
