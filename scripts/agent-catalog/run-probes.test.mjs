import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const sourceScript = join(sourceDir, "run-probes.sh");

function runPreflight(args = [], extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), "catalog-probe-selection-"));
  const scriptDir = join(root, "scripts", "agent-catalog");
  const home = join(root, "home");
  mkdirSync(scriptDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  cpSync(sourceScript, join(scriptDir, "run-probes.sh"));
  const result = spawnSync("bash", [join(scriptDir, "run-probes.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      HOME: home,
      PATH: process.env.PATH,
      ...extraEnv,
    },
  });
  const statePath = join(scriptDir, "generated", ".probe-logs", "run.state");
  let state = "";
  try {
    state = readFileSync(statePath, "utf8");
  } catch {}
  rmSync(root, { recursive: true, force: true });
  return { ...result, state };
}

function stateValues(state, key) {
  return state
    .split("\n")
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));
}

test("a Codex-only run requires every Codex context and no unrelated credentials", () => {
  const result = runPreflight(["--agent", "codex"]);

  assert.equal(result.status, 2);
  assert.deepEqual(stateValues(result.state, "required"), [
    "codex.openai-api",
    "codex.openai-oauth",
    "codex.bedrock",
  ]);
  assert.match(result.stderr, /codex\.openai-api/);
  assert.match(result.stderr, /codex\.openai-oauth/);
  assert.match(result.stderr, /codex\.bedrock/);
  assert.doesNotMatch(result.stderr, /claude\.|opencode\.|grok\.|cursor\./);
  assert.ok(stateValues(result.state, "retained").includes("claude.anthropic-api"));
  assert.ok(stateValues(result.state, "retained").includes("cursor.cursor-login"));
});

test("CATALOG_PROBE_AGENTS accepts a comma-separated focused selection", () => {
  const result = runPreflight([], { CATALOG_PROBE_AGENTS: "codex,grok" });

  assert.equal(result.status, 2);
  assert.deepEqual(stateValues(result.state, "required"), [
    "codex.openai-api",
    "codex.openai-oauth",
    "codex.bedrock",
    "grok.xai-api",
  ]);
  assert.doesNotMatch(result.stderr, /claude\.|opencode\.|cursor\./);
});

test("a credential-complete focused run selects its active agent on Bash 3.2", () => {
  const result = runPreflight(["--agent", "codex"], {
    OPENAI_API_KEY: "test-openai-key",
    AWS_BEARER_TOKEN_BEDROCK: "test-bedrock-token",
    PROBE_CODEX_OAUTH_AUTH_JSON: sourceScript,
  });

  assert.notEqual(result.status, 0);
  assert.deepEqual(stateValues(result.state, "agent"), ["codex"]);
  assert.doesNotMatch(result.stderr, /active_agents\[@\]: unbound variable/);
});

test("agent selections reject unknown names before changing probe state", () => {
  const result = runPreflight(["--agent=not-a-harness"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown catalog probe agent 'not-a-harness'/);
  assert.equal(result.state, "");
});

test("Cursor remains opt-in even when it is explicitly selected", () => {
  const result = runPreflight(["--agent", "cursor"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /cursor probing is opt-in/);
  assert.equal(result.state, "");
});

test("the default authoritative selection retains Cursor", () => {
  const result = runPreflight();

  assert.equal(result.status, 2);
  assert.ok(stateValues(result.state, "required").includes("claude.anthropic-api"));
  assert.ok(stateValues(result.state, "required").includes("codex.openai-api"));
  assert.ok(stateValues(result.state, "required").includes("opencode.baseline"));
  assert.ok(stateValues(result.state, "required").includes("grok.xai-api"));
  assert.ok(!stateValues(result.state, "required").includes("cursor.cursor-login"));
  assert.ok(stateValues(result.state, "retained").includes("cursor.cursor-login"));
});
