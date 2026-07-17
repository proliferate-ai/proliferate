import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("./run-termination.fixture.ts", import.meta.url));

test("a failed Tier-2 boot closes its fake and the CLI exits after writing the aggregate", async () => {
  const result = await runFixture(FIXTURE, 15_000);

  assert.equal(result.timedOut, false, `fixture did not terminate; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /Combined report written:/);
  assert.match(result.stdout, /1 failed/);
  assert.match(result.stdout, /intended exit 1/);
  assert.equal(result.code, 1, `unexpected exit; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});

function runFixture(
  fixture: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.resolve(fixture)], {
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
