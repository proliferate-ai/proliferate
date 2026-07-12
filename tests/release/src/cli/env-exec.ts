/**
 * Least-privilege launcher for commands that run before the release runner.
 *
 * The canonical owner-only dotenv file is parsed as data by
 * `loadReleaseEnvironment`; only explicitly allowed, persistable manifest
 * names are materialized for the child. Values are never printed.
 */

import { spawn } from "node:child_process";

import { findEnvVarSpec } from "../config/env-manifest.js";
import {
  loadReleaseEnvironment,
  ReleaseEnvironmentFileError,
} from "../config/local-environment.js";

export interface EnvExecArgs {
  allowedNames: ReadonlySet<string>;
  command: string;
  commandArgs: readonly string[];
}

export function parseEnvExecArgs(argv: readonly string[]): EnvExecArgs {
  const allowedNames = new Set<string>();
  let index = 0;
  for (; index < argv.length && argv[index] !== "--"; index += 1) {
    if (argv[index] !== "--allow") {
      throw new Error(`unknown env:exec argument: ${argv[index]}`);
    }
    const name = argv[index + 1]?.trim();
    if (!name || name === "--") {
      throw new Error("--allow requires an environment variable name");
    }
    allowedNames.add(name);
    index += 1;
  }
  if (argv[index] !== "--") {
    throw new Error("env:exec requires -- before the child command");
  }
  if (allowedNames.size === 0) {
    throw new Error("env:exec requires at least one --allow NAME");
  }
  const command = argv[index + 1]?.trim();
  if (!command) {
    throw new Error("env:exec requires a child command after --");
  }

  for (const name of allowedNames) {
    const spec = findEnvVarSpec(name);
    if (!spec) {
      throw new Error(`${name} is not declared by the release environment manifest`);
    }
    if (spec.persistentFileAllowed === false) {
      throw new Error(`${name} is a per-run authorization and cannot be loaded by env:exec`);
    }
  }

  return {
    allowedNames,
    command,
    commandArgs: argv.slice(index + 2),
  };
}

export async function runEnvExec(args: EnvExecArgs): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  loadReleaseEnvironment({ allowedNames: args.allowedNames });
  return await new Promise((resolve, reject) => {
    const child = spawn(args.command, [...args.commandArgs], {
      // Package managers run scripts from the package directory and preserve
      // the caller's directory in INIT_CWD. The wrapped command must behave as
      // if the operator invoked it directly (not from tests/release).
      cwd: process.env.INIT_CWD || process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function main(): Promise<void> {
  try {
    const result = await runEnvExec(parseEnvExecArgs(process.argv.slice(2)));
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exitCode = result.code ?? 1;
  } catch (error) {
    const prefix = error instanceof ReleaseEnvironmentFileError
      ? "env:exec credential-file error"
      : "env:exec configuration error";
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`${prefix}: ${detail}`);
    process.exitCode = 2;
  }
}

await main();
