/**
 * Secure local-secret loading for the managed-cloud world.
 *
 * Per the workstream contract: local secrets live in
 * `~/.proliferate-local/dev/release-e2e.env` (and additional provider
 * credentials may live in `server/.env`). Those files are PARSED AS DATA — they
 * are never sourced through a shell, so a malicious/typo'd value cannot execute
 * a command or leak into the shell environment. The ambient process environment
 * always wins over a file value (CI supplies protected env; the file is only a
 * local convenience).
 *
 * This parser deliberately does NOT support shell features (command
 * substitution, variable interpolation, arithmetic). It understands only:
 *   - `KEY=VALUE` and `export KEY=VALUE`
 *   - `# comment` lines and inline trailing comments on unquoted values
 *   - single- and double-quoted values (quotes stripped; no interpolation)
 * Anything else on a line is ignored rather than executed.
 *
 * Nothing here ever logs a value. `describeMerged` returns names + presence
 * only, for evidence and diagnostics.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_RELEASE_E2E_ENV = ".proliferate-local/dev/release-e2e.env";
export const DEFAULT_SERVER_ENV_RELATIVE = "server/.env";

export interface ParsedEnvFile {
  /** Only keys that parsed cleanly. */
  readonly values: Readonly<Record<string, string>>;
  /** 1-based line numbers that were present but unparseable (names/values never captured). */
  readonly ignoredLines: readonly number[];
}

/**
 * Parses dotenv-style TEXT as pure data. Never evaluates a shell. Unknown /
 * malformed lines are recorded as ignored rather than throwing, so one bad
 * line cannot deny every credential.
 */
export function parseEnvData(text: string): ParsedEnvFile {
  const values: Record<string, string> = {};
  const ignoredLines: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) {
      ignoredLines.push(i + 1);
      continue;
    }
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      ignoredLines.push(i + 1);
      continue;
    }
    const value = parseValue(withoutExport.slice(eq + 1));
    values[key] = value;
  }
  return { values, ignoredLines };
}

function parseValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const first = trimmed[0];
  if (first === '"' || first === "'") {
    const closing = trimmed.indexOf(first, 1);
    if (closing > 0) {
      // Quoted: take exactly the quoted span; no interpolation, no escape
      // processing beyond the literal characters.
      return trimmed.slice(1, closing);
    }
    // Unterminated quote — treat the remainder literally minus the open quote.
    return trimmed.slice(1);
  }
  // Unquoted: strip an inline trailing comment (space + #).
  const commentIdx = trimmed.search(/\s+#/);
  return (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim();
}

/** Reads and parses a file if present; a missing/unreadable file yields empty. */
export function loadEnvFile(filePath: string): ParsedEnvFile {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return { values: {}, ignoredLines: [] };
  }
  return parseEnvData(text);
}

export type EnvSource = "ambient" | "release-e2e-env" | "server-env" | "absent";

export interface MergedEnv {
  /** Effective value for a name (ambient wins over any file). */
  get(name: string): string | undefined;
  present(name: string): boolean;
  /** Which source supplied the effective value, for evidence — never the value. */
  source(name: string): EnvSource;
}

export interface MergeOptions {
  /** Defaults to process.env. Ambient always wins. */
  readonly ambient?: NodeJS.ProcessEnv;
  /** Default: ~/.proliferate-local/dev/release-e2e.env */
  readonly releaseEnvPath?: string;
  /** Default: <repoRoot>/server/.env, resolved from this module. */
  readonly serverEnvPath?: string;
  /** Injected loader for tests. */
  readonly load?: (p: string) => ParsedEnvFile;
}

/**
 * Merges ambient env over the two data files. Precedence (highest first):
 * ambient env, release-e2e.env, server/.env. An empty-string ambient value is
 * treated as absent so `FOO=` does not shadow a real file value.
 */
export function loadMergedEnv(options: MergeOptions = {}): MergedEnv {
  const ambient = options.ambient ?? process.env;
  const load = options.load ?? loadEnvFile;
  const releaseEnvPath =
    options.releaseEnvPath ?? path.join(os.homedir(), DEFAULT_RELEASE_E2E_ENV);
  const serverEnvPath =
    options.serverEnvPath ?? path.resolve(import.meta.dirname, "../../../../../../", DEFAULT_SERVER_ENV_RELATIVE);

  const releaseEnv = load(releaseEnvPath).values;
  const serverEnv = load(serverEnvPath).values;

  const resolve = (name: string): { value: string | undefined; source: EnvSource } => {
    const ambientRaw = ambient[name];
    if (ambientRaw !== undefined && ambientRaw.trim().length > 0) {
      return { value: ambientRaw, source: "ambient" };
    }
    const fromRelease = releaseEnv[name];
    if (fromRelease !== undefined && fromRelease.length > 0) {
      return { value: fromRelease, source: "release-e2e-env" };
    }
    const fromServer = serverEnv[name];
    if (fromServer !== undefined && fromServer.length > 0) {
      return { value: fromServer, source: "server-env" };
    }
    return { value: undefined, source: "absent" };
  };

  return {
    get: (name) => resolve(name).value,
    present: (name) => resolve(name).value !== undefined,
    source: (name) => resolve(name).source,
  };
}
