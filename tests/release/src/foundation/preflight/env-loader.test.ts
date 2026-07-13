import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadReleaseEnvironment,
  parseReleaseEnvironmentFile,
  ReleaseEnvironmentFileError,
  ENV_FILE_VARIABLE,
} from "./env-loader.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "envload-"));
}

test("parses NAME=value, export prefix, quotes, and comments as data", () => {
  const parsed = parseReleaseEnvironmentFile(
    [
      "# a comment",
      "PLAIN=value1",
      "export EXPORTED=value2",
      "QUOTED=\"has spaces\"",
      "SINGLE='literal $NOEXPAND'",
      "TRAILING=value3 # inline comment",
      "",
    ].join("\n"),
  );
  assert.equal(parsed.get("PLAIN"), "value1");
  assert.equal(parsed.get("EXPORTED"), "value2");
  assert.equal(parsed.get("QUOTED"), "has spaces");
  assert.equal(parsed.get("SINGLE"), "literal $NOEXPAND");
  assert.equal(parsed.get("TRAILING"), "value3");
});

test("rejects a malformed line and a duplicate key", () => {
  assert.throws(() => parseReleaseEnvironmentFile("not a valid line"), ReleaseEnvironmentFileError);
  assert.throws(() => parseReleaseEnvironmentFile("A=1\nA=2"), ReleaseEnvironmentFileError);
});

test("ambient environment wins; only unset names are copied", () => {
  const dir = tmp();
  const file = path.join(dir, "release-e2e.env");
  writeFileSync(file, "A=fromfile\nB=fromfile\n", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { [ENV_FILE_VARIABLE]: file, A: "ambient" };
  const result = loadReleaseEnvironment({ env, homeDir: dir, uid: undefined });
  assert.equal(env.A, "ambient", "ambient value must win");
  assert.equal(env.B, "fromfile", "unset value is loaded from the file");
  assert.deepEqual([...result.preservedNames].sort(), ["A"]);
  assert.deepEqual([...result.loadedNames].sort(), ["B"]);
  rmSync(dir, { recursive: true, force: true });
});

test("allowedNames restricts which keys are materialized", () => {
  const dir = tmp();
  const file = path.join(dir, "release-e2e.env");
  writeFileSync(file, "A=1\nB=2\n", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { [ENV_FILE_VARIABLE]: file };
  const result = loadReleaseEnvironment({ env, homeDir: dir, allowedNames: new Set(["A"]) });
  assert.equal(env.A, "1");
  assert.equal(env.B, undefined);
  assert.deepEqual([...result.ignoredNames], ["B"]);
  rmSync(dir, { recursive: true, force: true });
});

test("refuses a symlinked credential file", () => {
  const dir = tmp();
  const real = path.join(dir, "real.env");
  const link = path.join(dir, "link.env");
  writeFileSync(real, "A=1\n", { mode: 0o600 });
  symlinkSync(real, link);
  assert.throws(
    () => loadReleaseEnvironment({ env: { [ENV_FILE_VARIABLE]: link }, homeDir: dir }),
    /symbolic link/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("refuses world/group-readable permissions", () => {
  const dir = tmp();
  const file = path.join(dir, "release-e2e.env");
  writeFileSync(file, "A=1\n");
  chmodSync(file, 0o644);
  assert.throws(() => loadReleaseEnvironment({ env: { [ENV_FILE_VARIABLE]: file }, homeDir: dir }), /permissions/);
  rmSync(dir, { recursive: true, force: true });
});

test("explicit missing file throws; default missing file is a soft miss", () => {
  const dir = tmp();
  assert.throws(
    () => loadReleaseEnvironment({ env: { [ENV_FILE_VARIABLE]: path.join(dir, "nope.env") }, homeDir: dir }),
    /missing file/,
  );
  const soft = loadReleaseEnvironment({ env: {}, homeDir: path.join(dir, "no-home") });
  assert.equal(soft.status, "missing");
  rmSync(dir, { recursive: true, force: true });
});

test("CI without an explicit file skips local loading entirely", () => {
  const result = loadReleaseEnvironment({ env: { GITHUB_ACTIONS: "true" }, homeDir: "/nonexistent", treatAsCi: true });
  assert.equal(result.status, "skipped-ci");
  assert.deepEqual([...result.loadedNames], []);
});
