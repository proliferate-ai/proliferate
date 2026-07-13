import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEnvData, loadMergedEnv, type ParsedEnvFile } from "./env-file.js";

test("parseEnvData reads KEY=VALUE and export-prefixed lines", () => {
  const parsed = parseEnvData("A=1\nexport B=2\n");
  assert.equal(parsed.values.A, "1");
  assert.equal(parsed.values.B, "2");
});

test("parseEnvData strips quotes without interpolation", () => {
  const parsed = parseEnvData(`A="hello world"\nB='literal $NOT_EXPANDED'\n`);
  assert.equal(parsed.values.A, "hello world");
  assert.equal(parsed.values.B, "literal $NOT_EXPANDED");
});

test("parseEnvData ignores comments and blank lines, strips inline comments on unquoted values", () => {
  const parsed = parseEnvData("# comment\n\nA=1 # trailing\nB=has#hash\n");
  assert.equal(parsed.values.A, "1");
  // A '#' with no preceding space is part of the value.
  assert.equal(parsed.values.B, "has#hash");
});

test("parseEnvData never executes shell constructs — they are recorded as ignored, not run", () => {
  const parsed: ParsedEnvFile = parseEnvData("$(rm -rf /)\n`whoami`\nA=$(echo pwned)\n");
  // The bare command lines are ignored (no '=').
  assert.ok(parsed.ignoredLines.includes(1));
  assert.ok(parsed.ignoredLines.includes(2));
  // A line with '=' keeps the literal text — no command substitution happens.
  assert.equal(parsed.values.A, "$(echo pwned)");
});

test("parseEnvData rejects malformed keys as ignored lines", () => {
  const parsed = parseEnvData("1BAD=x\n-also-bad=y\nGOOD_1=z\n");
  assert.equal(parsed.values.GOOD_1, "z");
  assert.equal(parsed.values["1BAD"], undefined);
  assert.equal(parsed.ignoredLines.length, 2);
});

test("loadMergedEnv: ambient wins over release-e2e.env wins over server/.env", () => {
  const files: Record<string, ParsedEnvFile> = {
    "/release.env": { values: { X: "release", Y: "release", Z: "release" }, ignoredLines: [] },
    "/server.env": { values: { X: "server", Y: "server", Z: "server", ONLY_SERVER: "s" }, ignoredLines: [] },
  };
  const merged = loadMergedEnv({
    ambient: { X: "ambient" },
    releaseEnvPath: "/release.env",
    serverEnvPath: "/server.env",
    load: (p) => files[p] ?? { values: {}, ignoredLines: [] },
  });
  assert.equal(merged.get("X"), "ambient");
  assert.equal(merged.source("X"), "ambient");
  assert.equal(merged.get("Y"), "release");
  assert.equal(merged.source("Y"), "release-e2e-env");
  assert.equal(merged.get("ONLY_SERVER"), "s");
  assert.equal(merged.source("ONLY_SERVER"), "server-env");
  assert.equal(merged.get("MISSING"), undefined);
  assert.equal(merged.source("MISSING"), "absent");
});

test("loadMergedEnv: empty-string ambient does not shadow a real file value", () => {
  const merged = loadMergedEnv({
    ambient: { X: "  " },
    releaseEnvPath: "/r",
    serverEnvPath: "/s",
    load: (p): ParsedEnvFile => (p === "/r" ? { values: { X: "real" }, ignoredLines: [] } : { values: {}, ignoredLines: [] }),
  });
  assert.equal(merged.get("X"), "real");
  assert.equal(merged.source("X"), "release-e2e-env");
});
