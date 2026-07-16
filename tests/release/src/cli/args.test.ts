import assert from "node:assert/strict";
import { test } from "node:test";

import { CliUsageError, parseArgs } from "./args.js";

test("parses explicit diagnostic and strict behaviors", () => {
  assert.equal(parseArgs(["--behavior", "diagnostic"]).behavior, "diagnostic");
  assert.equal(
    parseArgs(["--behavior", "strict", "--candidate-build-map", "map.json"]).behavior,
    "strict",
  );
});

test("rejects an omitted --behavior", () => {
  assert.throws(() => parseArgs([]), CliUsageError);
});

test("rejects an invalid --behavior value", () => {
  assert.throws(() => parseArgs(["--behavior", "lenient"]), CliUsageError);
});

test("rejects strict dry-run", () => {
  assert.throws(() => parseArgs(["--behavior", "strict", "--dry-run"]), CliUsageError);
});

test("allows diagnostic dry-run", () => {
  const args = parseArgs(["--behavior", "diagnostic", "--dry-run"]);
  assert.equal(args.dryRun, true);
});

test("parses valid run/shard/attempt overrides", () => {
  const args = parseArgs([
    "--behavior",
    "diagnostic",
    "--run-id",
    "run-1",
    "--shard-id",
    "shard.a",
    "--attempt",
    "3",
  ]);
  assert.equal(args.runId, "run-1");
  assert.equal(args.shardId, "shard.a");
  assert.equal(args.attempt, 3);
});

test("rejects invalid attempt values", () => {
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--attempt", "0"]), CliUsageError);
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--attempt", "-1"]), CliUsageError);
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--attempt", "1.5"]), CliUsageError);
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--attempt", "abc"]), CliUsageError);
});

test("preserves existing lane/desktop/agents/scenarios/issue/output flags", () => {
  const args = parseArgs([
    "--behavior",
    "diagnostic",
    "--lane",
    "staging",
    "--desktop",
    "native",
    "--agents",
    "claude,codex",
    "--scenarios",
    "T3-WT-1,T3-CHAT-1",
    "--file-issues",
    "--output-dir",
    "out",
  ]);
  assert.equal(args.lane, "staging");
  assert.equal(args.desktop, "native");
  assert.deepEqual(args.agents, ["claude", "codex"]);
  assert.deepEqual(args.scenarios, ["T3-WT-1", "T3-CHAT-1"]);
  assert.equal(args.fileIssues, true);
  assert.equal(args.outputDir, "out");
});

test("--only remains an alias for --scenarios", () => {
  const args = parseArgs(["--behavior", "diagnostic", "--only", "T3-WT-1"]);
  assert.deepEqual(args.scenarios, ["T3-WT-1"]);
});

test("--cells parses a matrix-cell filter and defaults to all", () => {
  assert.equal(parseArgs(["--behavior", "diagnostic"]).cells, "all");
  assert.deepEqual(
    parseArgs(["--behavior", "diagnostic", "--cells", "SH-GATEWAY"]).cells,
    ["SH-GATEWAY"],
  );
  assert.deepEqual(
    parseArgs(["--behavior", "diagnostic", "--cells", "SH-GATEWAY,SH-GITHUB-AUTH"]).cells,
    ["SH-GATEWAY", "SH-GITHUB-AUTH"],
  );
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--cells", ","]), CliUsageError);
});

test("rejects empty lists", () => {
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--scenarios", ","]), CliUsageError);
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--agents", " , "]), CliUsageError);
});

test("rejects duplicate list values", () => {
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--scenarios", "T3-A,T3-A"]), CliUsageError);
});

test("rejects mixing all with named values", () => {
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--scenarios", "all,T3-A"]), CliUsageError);
});

test("a lone all parses to the all selector", () => {
  assert.equal(parseArgs(["--behavior", "diagnostic", "--scenarios", "all"]).scenarios, "all");
});

test("--help parses without --behavior (help never needs identity or a report)", () => {
  const args = parseArgs(["--help"]);
  assert.equal(args.help, true);
});

test("rejects unknown flags and invalid lane/desktop values as usage errors", () => {
  assert.throws(() => parseArgs(["--nope"]), CliUsageError);
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--lane", "prod"]), CliUsageError);
  assert.throws(() => parseArgs(["--behavior", "diagnostic", "--desktop", "mobile"]), CliUsageError);
});

test("parses --lane selfhost (the shipped qualification-selfhost target's lane, PR7-CONTROL-001)", () => {
  const args = parseArgs(["--behavior", "diagnostic", "--lane", "selfhost"]);
  assert.equal(args.lane, "selfhost");
});

test("parses --candidate-build-map", () => {
  const args = parseArgs(["--behavior", "diagnostic", "--candidate-build-map", "out/map.json"]);
  assert.equal(args.candidateBuildMap, "out/map.json");
});

test("strict without --candidate-build-map is rejected; with it, accepted", () => {
  assert.throws(() => parseArgs(["--behavior", "strict"]), CliUsageError);
  const args = parseArgs(["--behavior", "strict", "--candidate-build-map", "map.json"]);
  assert.equal(args.behavior, "strict");
  assert.equal(args.candidateBuildMap, "map.json");
});

test("diagnostic runs may omit the candidate build map", () => {
  const real = parseArgs(["--behavior", "diagnostic"]);
  assert.equal(real.candidateBuildMap, undefined);
  const dry = parseArgs(["--behavior", "diagnostic", "--dry-run"]);
  assert.equal(dry.candidateBuildMap, undefined);
});

test("--source-candidate satisfies the strict candidate-identity requirement", () => {
  const args = parseArgs(["--behavior", "strict", "--source-candidate"]);
  assert.equal(args.sourceCandidate, true);
  assert.equal(args.candidateBuildMap, undefined);
});

test("--source-candidate and --candidate-build-map are mutually exclusive", () => {
  assert.throws(
    () => parseArgs(["--behavior", "diagnostic", "--source-candidate", "--candidate-build-map", "map.json"]),
    CliUsageError,
  );
});

test("sourceCandidate defaults to false", () => {
  const args = parseArgs(["--behavior", "diagnostic"]);
  assert.equal(args.sourceCandidate, false);
});
