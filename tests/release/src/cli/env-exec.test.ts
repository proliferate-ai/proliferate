import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const tsx = path.join(repoRoot, "tests", "release", "node_modules", ".bin", "tsx");
const cli = path.join(here, "env-exec.ts");
const FILE_STRIPE = "sk_test_file_only_credential";
const FILE_E2B = "e2b_unselected_file_credential";

test("env:exec materializes only the selected file credential and logs no values", () => {
  withCredentialFile((filePath) => {
    const probe = [
      "process.stdout.write(JSON.stringify({",
      `stripe:process.env.STRIPE_TEST_SECRET_KEY===${JSON.stringify(FILE_STRIPE)},`,
      "e2bAbsent:process.env.RELEASE_E2E_E2B_API_KEY===undefined",
      "}))",
    ].join("");
    const result = runCli(
      ["--allow", "STRIPE_TEST_SECRET_KEY", "--", process.execPath, "-e", probe],
      filePath,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { stripe: true, e2bAbsent: true });
    assertNoCredentialOutput(result);
  });
});

test("env:exec preserves an ambient selected credential over the file", () => {
  withCredentialFile((filePath) => {
    const ambient = "sk_test_ambient_override";
    const probe = `process.stdout.write(String(process.env.STRIPE_TEST_SECRET_KEY===${JSON.stringify(ambient)}))`;
    const result = runCli(
      ["--allow", "STRIPE_TEST_SECRET_KEY", "--", process.execPath, "-e", probe],
      filePath,
      { STRIPE_TEST_SECRET_KEY: ambient },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "true");
    assertNoCredentialOutput(result);
  });
});

test("env:exec rejects unknown, persistent-forbidden, and malformed allowlists", () => {
  withCredentialFile((filePath) => {
    for (const args of [
      ["--allow", "NOT_DECLARED", "--", process.execPath, "-e", ""],
      ["--allow", "RELEASE_E2E_SELFHOST_PROVISION", "--", process.execPath, "-e", ""],
      ["--allow", "STRIPE_TEST_SECRET_KEY", process.execPath, "-e", ""],
      ["--", process.execPath, "-e", ""],
    ]) {
      const result = runCli(args, filePath);
      assert.equal(result.status, 2);
      assertNoCredentialOutput(result);
    }
  });
});

test("env:exec preserves the child exit code", () => {
  withCredentialFile((filePath) => {
    const result = runCli(
      ["--allow", "STRIPE_TEST_SECRET_KEY", "--", process.execPath, "-e", "process.exit(7)"],
      filePath,
    );
    assert.equal(result.status, 7);
    assertNoCredentialOutput(result);
  });
});

function runCli(
  args: readonly string[],
  filePath: string,
  extraEnv: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(tsx, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      HOME: path.dirname(path.dirname(path.dirname(filePath))),
      PATH: process.env.PATH,
      RELEASE_E2E_ENV_FILE: filePath,
      ...extraEnv,
    },
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function withCredentialFile(run: (filePath: string) => void): void {
  const homeDir = mkdtempSync(path.join(tmpdir(), "env-exec-home-"));
  try {
    const filePath = path.join(homeDir, ".proliferate-local", "dev", "release-e2e.env");
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    writeFileSync(
      filePath,
      `STRIPE_TEST_SECRET_KEY=${FILE_STRIPE}\nRELEASE_E2E_E2B_API_KEY=${FILE_E2B}\n`,
      { mode: 0o600 },
    );
    chmodSync(filePath, 0o600);
    run(filePath);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

function assertNoCredentialOutput(result: { stdout: string; stderr: string }): void {
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(output.includes(FILE_STRIPE), false);
  assert.equal(output.includes(FILE_E2B), false);
}
