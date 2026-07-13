/**
 * Secure local credential loading and secret redaction for the managed-cloud
 * upgrade world.
 *
 * The release runner's local secrets live in
 * `~/.proliferate-local/dev/release-e2e.env`. This module PARSES that file as
 * data — it never sources it as a shell — and copies only recognized keys into
 * the environment, with the ambient environment always winning (so a one-off
 * override never mutates the shared file). It refuses to read the file through
 * a symlink or with group/other-readable permissions, and never prints a value.
 *
 * Ported deliberately narrow from the combined foundation worktree's
 * `config/local-environment.ts` + `report/redaction.ts` (secure env loading and
 * secret redaction only); this copy is self-contained so it carries no
 * dependency on that worktree's env-manifest/release-policy coupling.
 */

import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_RELEASE_E2E_ENV_RELATIVE = ".proliferate-local/dev/release-e2e.env";
export const ENV_FILE_VARIABLE = "RELEASE_E2E_ENV_FILE";

const REDACTION = "[REDACTED_SECRET]";

export class SecureEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureEnvError";
  }
}

export interface SecureEnvLoadResult {
  readonly status: "loaded" | "missing" | "skipped-ci";
  readonly filePath: string;
  /** Names copied into env (were absent from the ambient environment). */
  readonly loadedNames: readonly string[];
  /** Names present in the file but preserved because ambient env already set them. */
  readonly preservedNames: readonly string[];
}

export interface SecureEnvLoadOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly uid?: number;
  /** Only these keys are copied; any other key in the file is a hard error. */
  readonly allowedNames: ReadonlySet<string>;
  /** Skip file loading under CI unless RELEASE_E2E_ENV_FILE is explicit. */
  readonly ciSkips?: boolean;
}

/**
 * Load recognized keys from the local credential file into `env`. Ambient env
 * wins. Returns which keys were loaded vs preserved; never returns a value.
 */
export function loadSecureEnv(options: SecureEnvLoadOptions): SecureEnvLoadResult {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const explicit = nonEmpty(env[ENV_FILE_VARIABLE]);
  const filePath = explicit
    ? expandHome(explicit, homeDir)
    : path.join(homeDir, DEFAULT_RELEASE_E2E_ENV_RELATIVE);

  if (!explicit && (options.ciSkips ?? true) && isCi(env)) {
    return { status: "skipped-ci", filePath, loadedNames: [], preservedNames: [] };
  }

  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      if (explicit) {
        throw new SecureEnvError(`${ENV_FILE_VARIABLE} points to a missing file: ${filePath}`);
      }
      return { status: "missing", filePath, loadedNames: [], preservedNames: [] };
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new SecureEnvError(`Refusing to load release credentials through a symlink: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new SecureEnvError(`Release credential path is not a regular file: ${filePath}`);
  }
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  if (uid !== undefined && stats.uid !== uid) {
    throw new SecureEnvError(
      `Release credential file must be owned by uid ${uid}: ${filePath} is owned by ${stats.uid}`,
    );
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new SecureEnvError(
      `Release credential file permissions too broad (${(stats.mode & 0o777)
        .toString(8)
        .padStart(3, "0")}): chmod 600 ${filePath}`,
    );
  }

  const parsed = parseEnvFile(readFileSync(filePath, "utf8"), filePath);
  const loadedNames: string[] = [];
  const preservedNames: string[] = [];
  for (const [name, value] of parsed) {
    if (!options.allowedNames.has(name)) {
      throw new SecureEnvError(`${filePath}: ${name} is not a recognized release-runner key`);
    }
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      preservedNames.push(name);
      continue;
    }
    env[name] = value;
    loadedNames.push(name);
  }
  return { status: "loaded", filePath, loadedNames, preservedNames };
}

/** Strict `NAME=value` / `export NAME=value` parser. No shell execution. */
export function parseEnvFile(contents: string, source = "release-e2e.env"): Map<string, string> {
  const parsed = new Map<string, string>();
  const lines = contents.replace(/^﻿/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      throw new SecureEnvError(`${source}:${index + 1}: expected NAME=value or export NAME=value`);
    }
    const name = match[1];
    if (parsed.has(name)) {
      throw new SecureEnvError(`${source}:${index + 1}: duplicate key ${name}`);
    }
    parsed.set(name, parseValue(match[2]));
  }
  return parsed;
}

function parseValue(raw: string): string {
  if (raw.startsWith("'")) {
    const closing = raw.indexOf("'", 1);
    if (closing >= 0) return raw.slice(1, closing);
    return raw.slice(1);
  }
  if (raw.startsWith('"')) {
    let value = "";
    for (let i = 1; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === '"') return value;
      if (ch === "\\" && i + 1 < raw.length) {
        i += 1;
        const e = raw[i];
        value += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
        continue;
      }
      value += ch;
    }
    return value;
  }
  return raw.replace(/\s+#.*$/, "").trim();
}

/**
 * Redact every provided secret value (and common encodings) from `input`, plus
 * URL userinfo. Longer values are redacted first so a short prefix cannot leak.
 */
export function redactSecrets(input: string, secretValues: readonly string[]): string {
  const variants = new Set<string>();
  for (const value of secretValues) {
    if (!value) continue;
    variants.add(value);
    variants.add(encodeURIComponent(value));
    variants.add(Buffer.from(value, "utf8").toString("base64"));
    variants.add(Buffer.from(`x-access-token:${value}`, "utf8").toString("base64"));
  }
  let redacted = input;
  for (const value of [...variants].sort((a, b) => b.length - a.length)) {
    if (value.length > 0) redacted = redacted.split(value).join(REDACTION);
  }
  return redacted.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, `$1${REDACTION}@`);
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
  return (
    env.CI === "true" || env.CI === "1" || env.GITHUB_ACTIONS === "true" || env.GITHUB_ACTIONS === "1"
  );
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
