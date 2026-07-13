import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ReleaseEnvironmentFileError,
  loadReleaseEnvironment,
  parseReleaseEnvironmentFile,
} from "./env.js";

test("parses NAME=value, export prefix, quotes, and trailing comments", () => {
  const parsed = parseReleaseEnvironmentFile(
    [
      "# a comment",
      "RELEASE_E2E_SERVER_URL=http://127.0.0.1:8086",
      "export RELEASE_E2E_GATEWAY_TEST_KEY='sk-secret-value'  # inline",
      'RELEASE_E2E_GATEWAY_BASE_URL="https://gw.example.com"',
      "",
    ].join("\n"),
  );
  assert.equal(parsed.get("RELEASE_E2E_SERVER_URL"), "http://127.0.0.1:8086");
  assert.equal(parsed.get("RELEASE_E2E_GATEWAY_TEST_KEY"), "sk-secret-value");
  assert.equal(parsed.get("RELEASE_E2E_GATEWAY_BASE_URL"), "https://gw.example.com");
});

test("rejects a malformed line", () => {
  assert.throws(() => parseReleaseEnvironmentFile("not a key value line"), ReleaseEnvironmentFileError);
});

test("rejects a duplicate key", () => {
  assert.throws(
    () => parseReleaseEnvironmentFile("RELEASE_E2E_SERVER_URL=a\nRELEASE_E2E_SERVER_URL=b"),
    ReleaseEnvironmentFileError,
  );
});

test("ambient environment wins over the file (no override)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tf-local-env-"));
  const file = path.join(dir, "release-e2e.env");
  writeFileSync(file, "RELEASE_E2E_SERVER_URL=http://from-file:1\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  const env: NodeJS.ProcessEnv = {
    RELEASE_E2E_ENV_FILE: file,
    RELEASE_E2E_SERVER_URL: "http://ambient:2",
  };
  const result = loadReleaseEnvironment({ env, uid: undefined });
  assert.equal(result.status, "loaded");
  assert.equal(env.RELEASE_E2E_SERVER_URL, "http://ambient:2");
  assert.ok(result.preservedNames.includes("RELEASE_E2E_SERVER_URL"));
});

test("materializes only manifest-declared keys and rejects unknown ones", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tf-local-env-"));
  const file = path.join(dir, "release-e2e.env");
  writeFileSync(file, "TOTALLY_UNKNOWN_KEY=x\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  assert.throws(
    () => loadReleaseEnvironment({ env: { RELEASE_E2E_ENV_FILE: file }, uid: undefined }),
    ReleaseEnvironmentFileError,
  );
});

test("refuses world/group-readable files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tf-local-env-"));
  const file = path.join(dir, "release-e2e.env");
  writeFileSync(file, "RELEASE_E2E_SERVER_URL=http://x:1\n", { mode: 0o644 });
  chmodSync(file, 0o644);
  assert.throws(
    () => loadReleaseEnvironment({ env: { RELEASE_E2E_ENV_FILE: file }, uid: undefined }),
    /permissions are too broad/,
  );
});

test("missing default file is not an error (returns 'missing')", () => {
  const result = loadReleaseEnvironment({
    env: {},
    homeDir: path.join(tmpdir(), "nonexistent-home-xyz"),
    uid: undefined,
  });
  assert.equal(result.status, "missing");
});
