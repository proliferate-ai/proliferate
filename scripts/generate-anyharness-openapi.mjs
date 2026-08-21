#!/usr/bin/env node
// Regenerates anyharness/sdk/generated/openapi.json from the runtime's own
// schema printer.
//
// This exists as a script rather than an inline npm script because the inline
// version was `mkdir -p ... && cd ../.. && cargo run ... > file`, which is
// POSIX shell. npm runs package scripts through cmd.exe on Windows, and that
// command does not work there: cmd's `md` reports "The syntax of the command
// is incorrect." and creates nothing, so the `&&` chain never reaches cargo.
// That single line is the stated reason desktop Windows releases were
// disabled in 3d3c0504b8 ("until the SDK generation step is Windows-safe").
//
// Doing the directory creation, the cargo invocation and the file write in
// node keeps the behaviour identical on every platform and removes the shell
// from the path entirely.
//
// SKIP_RUST=1 with an executable ANYHARNESS_DEV_RUNTIME_BIN skips cargo
// entirely and calls the prebuilt runtime binary's print-openapi output
// instead, same as the shell version this replaced.

import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkDir = join(repoRoot, "anyharness", "sdk");
const outFile = join(sdkDir, "generated", "openapi.json");

mkdirSync(join(sdkDir, "generated"), { recursive: true });
mkdirSync(join(sdkDir, "src", "generated"), { recursive: true });

// SKIP_RUST=1 means "no cargo in this worktree". Honor it here too: the
// prebuilt runtime emits the same schema, so a frontend-only worktree does
// not need a toolchain just to regenerate the SDK. Without this the flag
// leaks and `SKIP_RUST=1 make sdk-generate` still invokes cargo.
const skipRust = process.env.SKIP_RUST;
const runtimeBin = process.env.ANYHARNESS_DEV_RUNTIME_BIN ?? "";
const useRuntimeBin =
  Boolean(skipRust) &&
  skipRust !== "0" &&
  runtimeBin !== "" &&
  (() => {
    try {
      accessSync(runtimeBin, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  })();

// `||` rather than `??` so an empty CARGO falls back to "cargo" and reports a
// normal missing-runtime error, rather than throwing ERR_INVALID_ARG_VALUE.
const cargo = process.env.CARGO || "cargo";
const command = useRuntimeBin ? runtimeBin : cargo;
const args = useRuntimeBin ? ["print-openapi"] : ["run", "--bin", "anyharness", "--", "print-openapi"];

if (useRuntimeBin) {
  console.log(`sdk-generate: SKIP_RUST set, using prebuilt runtime ${runtimeBin}`);
}

const result = spawnSync(command, args, {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
  stdio: ["ignore", "pipe", "inherit"],
});

if (result.error) {
  console.error(`failed to run ${command}: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`${command} ${args.join(" ")} exited with ${result.status}`);
  process.exit(result.status ?? 1);
}
if (!result.stdout || result.stdout.trim() === "") {
  console.error("print-openapi produced no output; refusing to write an empty schema");
  process.exit(1);
}

// Parse before writing so a runtime that fails halfway through cannot leave a
// truncated schema on disk that openapi-typescript then happily consumes.
try {
  JSON.parse(result.stdout);
} catch (error) {
  console.error(`print-openapi did not produce valid JSON: ${error.message}`);
  process.exit(1);
}

writeFileSync(outFile, result.stdout);
console.log(`wrote ${outFile}`);
