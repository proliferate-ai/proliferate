import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  loadReleaseEnvironment,
  parseReleaseEnvironmentFile,
  ReleaseEnvironmentFileError,
} from "./local-environment.js";

test("parseReleaseEnvironmentFile supports export, comments, quotes, equals, and escapes", () => {
  const parsed = parseReleaseEnvironmentFile(
    [
      "# local credentials",
      "export RELEASE_E2E_SERVER_URL=http://127.0.0.1:8086",
      "RELEASE_E2E_GATEWAY_TEST_KEY='sk=value#literal'",
      'RELEASE_POLICY="release\\nstrict" # comment',
      "",
    ].join("\n"),
  );
  assert.equal(parsed.get("RELEASE_E2E_SERVER_URL"), "http://127.0.0.1:8086");
  assert.equal(parsed.get("RELEASE_E2E_GATEWAY_TEST_KEY"), "sk=value#literal");
  assert.equal(parsed.get("RELEASE_POLICY"), "release\nstrict");
});

test("loadReleaseEnvironment loads the owner-only default file without overwriting ambient env", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-env-home-"));
  try {
    const filePath = path.join(homeDir, ".proliferate-local/dev/release-e2e.env");
    writeSecretFile(
      filePath,
      [
        "export RELEASE_E2E_SERVER_URL=http://from-file.test",
        "RELEASE_E2E_GATEWAY_TEST_KEY=file-secret",
      ].join("\n"),
    );
    const env: NodeJS.ProcessEnv = { RELEASE_E2E_SERVER_URL: "http://ambient.test" };
    const result = loadReleaseEnvironment({ env, homeDir });

    assert.equal(result.status, "loaded");
    assert.deepEqual(result.loadedNames, ["RELEASE_E2E_GATEWAY_TEST_KEY"]);
    assert.deepEqual(result.preservedNames, ["RELEASE_E2E_SERVER_URL"]);
    assert.equal(env.RELEASE_E2E_SERVER_URL, "http://ambient.test");
    assert.equal(env.RELEASE_E2E_GATEWAY_TEST_KEY, "file-secret");
    assert.equal(JSON.stringify(result).includes("file-secret"), false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("loadReleaseEnvironment treats an explicit empty ambient value as intentional", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-env-home-"));
  try {
    const filePath = path.join(homeDir, ".proliferate-local/dev/release-e2e.env");
    writeSecretFile(filePath, "RELEASE_E2E_SERVER_URL=http://from-file.test\n");
    const env: NodeJS.ProcessEnv = { RELEASE_E2E_SERVER_URL: "" };
    loadReleaseEnvironment({ env, homeDir });
    assert.equal(env.RELEASE_E2E_SERVER_URL, "");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("loadReleaseEnvironment validates but does not materialize unselected credentials", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-env-home-"));
  try {
    const filePath = path.join(homeDir, ".proliferate-local/dev/release-e2e.env");
    writeSecretFile(
      filePath,
      [
        "RELEASE_E2E_GATEWAY_TEST_KEY=selected-secret",
        "RELEASE_E2E_E2B_API_KEY=unrelated-secret",
      ].join("\n"),
    );
    const env: NodeJS.ProcessEnv = {};
    const result = loadReleaseEnvironment({
      env,
      homeDir,
      allowedNames: new Set(["RELEASE_E2E_GATEWAY_TEST_KEY"]),
    });

    assert.equal(env.RELEASE_E2E_GATEWAY_TEST_KEY, "selected-secret");
    assert.equal(env.RELEASE_E2E_E2B_API_KEY, undefined);
    assert.deepEqual(result.loadedNames, ["RELEASE_E2E_GATEWAY_TEST_KEY"]);
    assert.deepEqual(result.ignoredNames, ["RELEASE_E2E_E2B_API_KEY"]);
    assert.equal(JSON.stringify(result).includes("unrelated-secret"), false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("loadReleaseEnvironment skips the implicit home file in CI", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-env-home-"));
  try {
    const filePath = path.join(homeDir, ".proliferate-local/dev/release-e2e.env");
    writeSecretFile(filePath, "RELEASE_E2E_SERVER_URL=http://should-not-load.test\n");
    const env: NodeJS.ProcessEnv = { CI: "true" };
    const result = loadReleaseEnvironment({ env, homeDir });
    assert.equal(result.status, "skipped-ci");
    assert.equal(env.RELEASE_E2E_SERVER_URL, undefined);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("loadReleaseEnvironment fails when an explicit file is missing", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-env-home-"));
  try {
    assert.throws(
      () =>
        loadReleaseEnvironment({
          env: { RELEASE_E2E_ENV_FILE: path.join(homeDir, "missing.env") },
          homeDir,
        }),
      /points to a missing file/,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("loadReleaseEnvironment rejects broad permissions, symlinks, duplicate keys, and unknown keys", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-env-home-"));
  try {
    const broad = path.join(homeDir, "broad.env");
    writeSecretFile(broad, "RELEASE_E2E_SERVER_URL=http://example.test\n");
    chmodSync(broad, 0o644);
    assert.throws(
      () => loadReleaseEnvironment({ env: { RELEASE_E2E_ENV_FILE: broad }, homeDir }),
      /chmod 600/,
    );

    const target = path.join(homeDir, "target.env");
    const link = path.join(homeDir, "link.env");
    writeSecretFile(target, "RELEASE_E2E_SERVER_URL=http://example.test\n");
    symlinkSync(target, link);
    assert.throws(
      () => loadReleaseEnvironment({ env: { RELEASE_E2E_ENV_FILE: link }, homeDir }),
      /symbolic link/,
    );

    const duplicate = path.join(homeDir, "duplicate.env");
    writeSecretFile(duplicate, "RELEASE_E2E_SERVER_URL=a\nRELEASE_E2E_SERVER_URL=b\n");
    assert.throws(
      () => loadReleaseEnvironment({ env: { RELEASE_E2E_ENV_FILE: duplicate }, homeDir }),
      /duplicate key/,
    );

    const unknown = path.join(homeDir, "unknown.env");
    writeSecretFile(unknown, "PATH=/tmp/nope\n");
    assert.throws(
      () => loadReleaseEnvironment({ env: { RELEASE_E2E_ENV_FILE: unknown }, homeDir }),
      ReleaseEnvironmentFileError,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("persistent dotenv cannot authorize costly or mutating scenarios", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-env-home-"));
  try {
    for (const name of [
      "RELEASE_E2E_SELFHOST_PROVISION",
      "RELEASE_E2E_STAGING_ECS_PIN_BUMP",
      "RELEASE_E2E_DESKTOP_T4",
      "RELEASE_E2E_ALLOW_PROFILE_WORKTREE_MISMATCH",
    ]) {
      const filePath = path.join(homeDir, `${name}.env`);
      writeSecretFile(filePath, `${name}=1\n`);
      assert.throws(
        () => loadReleaseEnvironment({ env: { RELEASE_E2E_ENV_FILE: filePath }, homeDir }),
        /per-run authorization switch/,
      );
    }
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

function writeSecretFile(filePath: string, contents: string): void {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  writeFileSync(filePath, contents, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}
