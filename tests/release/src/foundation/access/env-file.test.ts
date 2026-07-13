import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  EnvFileParseError,
  loadLocalEnvironment,
  parseEnvFileContents,
  readEnvFileSource,
} from "./env-file.js";

const FAKE_SECRET = "sk_test_totally_fake_do_not_use_1234567890abcdef";

test("parses plain NAME=value lines", () => {
  const values = parseEnvFileContents("FOO=bar\nBAZ=qux\n");
  assert.equal(values.get("FOO"), "bar");
  assert.equal(values.get("BAZ"), "qux");
});

test("supports the export prefix (this repo's real release-e2e.env uses it)", () => {
  const values = parseEnvFileContents("export RELEASE_E2E_GATEWAY_TEST_KEY=abc123\n");
  assert.equal(values.get("RELEASE_E2E_GATEWAY_TEST_KEY"), "abc123");
});

test("skips comments and blank lines", () => {
  const values = parseEnvFileContents("# a comment\n\nFOO=bar\n   \n# another\nBAZ=qux\n");
  assert.deepEqual([...values.entries()].sort(), [
    ["BAZ", "qux"],
    ["FOO", "bar"],
  ]);
});

test("handles a trailing inline comment on an unquoted value", () => {
  const values = parseEnvFileContents("FOO=bar # trailing comment\n");
  assert.equal(values.get("FOO"), "bar");
});

test("supports single-quoted values verbatim (no expansion, no escapes)", () => {
  const values = parseEnvFileContents(String.raw`FOO='$HOME literal \n not-a-newline'` + "\n");
  assert.equal(values.get("FOO"), "$HOME literal \\n not-a-newline");
});

test("supports double-quoted values with a narrow escape set", () => {
  const values = parseEnvFileContents(String.raw`FOO="line1\nline2\ttabbed \"quoted\""` + "\n");
  assert.equal(values.get("FOO"), 'line1\nline2\ttabbed "quoted"');
});

test("never performs $VAR expansion or command substitution", () => {
  const values = parseEnvFileContents("FOO=$HOME\nBAR=`whoami`\n");
  assert.equal(values.get("FOO"), "$HOME");
  assert.equal(values.get("BAR"), "`whoami`");
});

test("is CRLF-tolerant", () => {
  const values = parseEnvFileContents("FOO=bar\r\nBAZ=qux\r\n");
  assert.equal(values.get("FOO"), "bar");
  assert.equal(values.get("BAZ"), "qux");
});

test("strips a leading UTF-8 BOM", () => {
  const values = parseEnvFileContents("﻿FOO=bar\n");
  assert.equal(values.get("FOO"), "bar");
});

test("rejects a malformed line, naming the line number and never echoing content", () => {
  assert.throws(() => parseEnvFileContents("not a valid line\n", "myfile.env"), (error: unknown) => {
    assert.ok(error instanceof EnvFileParseError);
    assert.match(error.message, /myfile\.env:1/);
    return true;
  });
});

test("rejects a duplicate key", () => {
  assert.throws(() => parseEnvFileContents("FOO=one\nFOO=two\n"), EnvFileParseError);
});

test("rejects an unterminated quoted value", () => {
  assert.throws(() => parseEnvFileContents('FOO="unterminated\n'), EnvFileParseError);
  assert.throws(() => parseEnvFileContents("FOO='unterminated\n"), EnvFileParseError);
});

test("readEnvFileSource reports a missing file as a status, not a throw", () => {
  const { source, values } = readEnvFileSource("/nonexistent/path/release-e2e.env", "release-e2e-env-file");
  assert.equal(source.status, "missing");
  assert.equal(values.size, 0);
});

test("readEnvFileSource never returns values in the source metadata — names only", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
  try {
    const file = path.join(dir, "release-e2e.env");
    writeFileSync(file, `RELEASE_E2E_GATEWAY_TEST_KEY=${FAKE_SECRET}\n`, "utf8");
    chmodSync(file, 0o600);
    const { source } = readEnvFileSource(file, "release-e2e-env-file");
    assert.equal(source.status, "loaded");
    assert.deepEqual(source.names, ["RELEASE_E2E_GATEWAY_TEST_KEY"]);
    assert.equal(JSON.stringify(source).includes(FAKE_SECRET), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEnvFileSource warns (without throwing) about group/world-readable permissions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
  try {
    const file = path.join(dir, "release-e2e.env");
    writeFileSync(file, "FOO=bar\n", "utf8");
    chmodSync(file, 0o644);
    const { source } = readEnvFileSource(file, "release-e2e-env-file");
    assert.equal(source.status, "loaded");
    assert.match(source.permissionsWarning ?? "", /chmod 600/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEnvFileSource refuses to read through a symlink", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
  try {
    const real = path.join(dir, "real.env");
    const link = path.join(dir, "release-e2e.env");
    writeFileSync(real, "FOO=bar\n", "utf8");
    symlinkSync(real, link);
    const { source, values } = readEnvFileSource(link, "release-e2e-env-file");
    assert.equal(source.status, "not-a-file");
    assert.equal(values.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadLocalEnvironment: ambient always wins over the file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
  try {
    const file = path.join(dir, "release-e2e.env");
    writeFileSync(file, "RELEASE_E2E_SERVER_URL=http://from-file.test\n", "utf8");
    chmodSync(file, 0o600);
    const env = loadLocalEnvironment({
      releaseEnvPath: file,
      ambient: { RELEASE_E2E_SERVER_URL: "http://from-ambient.test" },
    });
    assert.equal(env.resolve("RELEASE_E2E_SERVER_URL"), "http://from-ambient.test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadLocalEnvironment: falls back to the file when ambient is unset", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
  try {
    const file = path.join(dir, "release-e2e.env");
    writeFileSync(file, "RELEASE_E2E_SERVER_URL=http://from-file.test\n", "utf8");
    chmodSync(file, 0o600);
    const env = loadLocalEnvironment({ releaseEnvPath: file, ambient: {} });
    assert.equal(env.resolve("RELEASE_E2E_SERVER_URL"), "http://from-file.test");
    assert.equal(env.present("RELEASE_E2E_SERVER_URL"), true);
    assert.equal(env.present("SOME_OTHER_VAR"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadLocalEnvironment: release-e2e.env takes priority over server/.env for the same key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
  try {
    const releasePath = path.join(dir, "release-e2e.env");
    const serverPath = path.join(dir, "server.env");
    writeFileSync(releasePath, "SHARED_KEY=from-release\n", "utf8");
    writeFileSync(serverPath, "SHARED_KEY=from-server\nSERVER_ONLY_KEY=only-here\n", "utf8");
    chmodSync(releasePath, 0o600);
    chmodSync(serverPath, 0o600);
    const env = loadLocalEnvironment({ releaseEnvPath: releasePath, serverEnvPath: serverPath, ambient: {} });
    assert.equal(env.resolve("SHARED_KEY"), "from-release");
    assert.equal(env.resolve("SERVER_ONLY_KEY"), "only-here");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadLocalEnvironment: missing file(s) resolve gracefully, not throw", () => {
  const env = loadLocalEnvironment({
    releaseEnvPath: "/nonexistent/release-e2e.env",
    serverEnvPath: "/nonexistent/server.env",
    ambient: {},
  });
  assert.equal(env.resolve("ANYTHING"), undefined);
  assert.equal(env.sources.every((s) => s.status === "missing"), true);
});

test("loadLocalEnvironment: knownNames reports names only, and never leaks a value even under JSON.stringify", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
  try {
    const file = path.join(dir, "release-e2e.env");
    writeFileSync(file, `RELEASE_E2E_GATEWAY_TEST_KEY=${FAKE_SECRET}\n`, "utf8");
    chmodSync(file, 0o600);
    const env = loadLocalEnvironment({ releaseEnvPath: file, ambient: {} });
    assert.deepEqual(env.knownNames(), ["RELEASE_E2E_GATEWAY_TEST_KEY"]);
    assert.equal(JSON.stringify(env.sources).includes(FAKE_SECRET), false);
    assert.equal(JSON.stringify(env.knownNames()).includes(FAKE_SECRET), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
