import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("./exit-watchdog.fixture.ts", import.meta.url));
const TSX_LOADER_ARGS = currentTsxLoaderArgs();

test("a leaked post-report handle fails closed before it can monopolize CI", async () => {
  const result = await runFixture("leak", 3_000);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 2, result.stderr);
  assert.match(result.stdout, /Combined report written:/);
  assert.match(result.stderr, /process did not quiesce/);
  assert.match(result.stderr, /forcing infrastructure exit 2/);
});

test("the unref'd watchdog does not delay a healthy runner", async () => {
  const result = await runFixture("clean", 2_000);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /process did not quiesce/);
});

function runFixture(
  mode: "clean" | "leak",
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_LOADER_ARGS, path.resolve(FIXTURE), mode], {
      cwd: path.resolve(fileURLToPath(new URL("../../", import.meta.url))),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function currentTsxLoaderArgs(): string[] {
  const loaderArgs: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const arg = process.execArgv[index];
    if ((arg === "--require" || arg === "--import") && process.execArgv[index + 1]) {
      loaderArgs.push(arg, process.execArgv[index + 1]);
      index += 1;
    }
  }
  return loaderArgs.length > 0 ? loaderArgs : ["--import", "tsx"];
}
