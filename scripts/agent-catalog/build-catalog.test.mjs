import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(sourceDir, "..", "..");

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "catalog-build-test-"));
  try {
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "catalogs"), { recursive: true });
    cpSync(sourceDir, join(root, "scripts", "agent-catalog"), { recursive: true });
    cpSync(join(repoRoot, "catalogs", "agents"), join(root, "catalogs", "agents"), {
      recursive: true,
    });
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeCompleteState(root, selectedAgents = null) {
  const generated = join(root, "scripts", "agent-catalog", "generated");
  const logDir = join(generated, ".probe-logs");
  mkdirSync(logDir, { recursive: true });
  const contexts = readdirSync(generated)
    .filter((name) => name.endsWith(".probe.json") && !name.startsWith("cursor."))
    .map((name) => {
      const snapshot = JSON.parse(readFileSync(join(generated, name), "utf8"));
      return `${snapshot.agentKind}.${snapshot.authContext}`;
    })
    .filter((context) => !selectedAgents || selectedAgents.includes(context.split(".")[0]));
  const agents = [...new Set(contexts.map((context) => context.split(".")[0]))];
  const state = [
    "startedAt=2000-01-01T00:00:00Z",
    ...contexts.flatMap((context) => [`required=${context}`, `passed=${context}`]),
    ...agents.map((agent) => `agent=${agent}`),
    "retained=cursor.cursor-login",
    "complete=true",
    "",
  ].join("\n");
  writeFileSync(join(logDir, "run.state"), state);
  cpSync(
    join(root, "catalogs", "agents", "catalog.json"),
    join(logDir, "resolved-candidate.json"),
  );
}

function alignProbeVersions(root) {
  const generated = join(root, "scripts", "agent-catalog", "generated");
  const catalog = JSON.parse(
    readFileSync(join(root, "catalogs", "agents", "catalog.json"), "utf8"),
  );
  const harnesses = new Map(catalog.agents.map((agent) => [agent.kind, agent.harness]));
  for (const name of readdirSync(generated).filter((name) => name.endsWith(".probe.json"))) {
    const path = join(generated, name);
    const snapshot = JSON.parse(readFileSync(path, "utf8"));
    const harness = harnesses.get(snapshot.agentKind);
    snapshot.attestation = {
      ...(snapshot.attestation ?? {}),
      version: harness.agentProcess.version,
    };
    const nativeVersion = harness.native?.version ?? null;
    snapshot.nativeCli = nativeVersion
      ? {
          path: `/managed/${snapshot.agentKind}`,
          version: snapshot.agentKind === "codex"
            ? `codex-cli ${nativeVersion.replace(/^rust-v/, "")}`
            : `${nativeVersion} (Claude Code)`,
        }
      : null;
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
}

test("complete probe builds use the exact resolved candidate pins", () => {
  withFixture((root) => {
    alignProbeVersions(root);
    writeCompleteState(root);
    const staleCursorSnapshot = join(
      root,
      "scripts",
      "agent-catalog",
      "generated",
      "cursor.cursor-login.probe.json",
    );
    writeFileSync(staleCursorSnapshot, "stale retained snapshot must not be parsed");
    const script = join(root, "scripts", "agent-catalog", "build-catalog.mjs");
    execFileSync(process.execPath, [script, "--require-complete-probe"]);

    const candidate = JSON.parse(
      readFileSync(join(root, "catalogs", "agents", "catalog.json"), "utf8"),
    );
    const draft = JSON.parse(
      readFileSync(join(root, "scripts", "agent-catalog", "catalog.draft.json"), "utf8"),
    );
    const candidateHarnesses = Object.fromEntries(
      candidate.agents.map((agent) => [agent.kind, agent.harness]),
    );
    for (const agent of draft.agents) {
      assert.deepEqual(agent.harness, candidateHarnesses[agent.kind]);
      assert.ok(agent.harness.agentProcess.source);
    }
    assert.deepEqual(
      draft.agents.find((agent) => agent.kind === "cursor"),
      candidate.agents.find((agent) => agent.kind === "cursor"),
    );
  });
});

test("focused complete probes preserve every unselected agent unchanged", () => {
  withFixture((root) => {
    alignProbeVersions(root);
    writeCompleteState(root, ["codex"]);
    const bundled = JSON.parse(
      readFileSync(join(root, "catalogs", "agents", "catalog.json"), "utf8"),
    );
    const script = join(root, "scripts", "agent-catalog", "build-catalog.mjs");
    execFileSync(process.execPath, [script, "--require-complete-probe"]);

    const draft = JSON.parse(
      readFileSync(join(root, "scripts", "agent-catalog", "catalog.draft.json"), "utf8"),
    );
    const draftByKind = new Map(draft.agents.map((agent) => [agent.kind, agent]));
    for (const previous of bundled.agents) {
      if (previous.kind !== "codex") {
        assert.deepEqual(draftByKind.get(previous.kind), previous);
      }
    }
  });
});

test("candidate native versions compare across vendor output formats", () => {
  withFixture((root) => {
    alignProbeVersions(root);
    writeCompleteState(root);
    const snapshotPath = join(
      root,
      "scripts",
      "agent-catalog",
      "generated",
      "codex.openai-api.probe.json",
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.nativeCli.version = "2.1.181 (Claude Code)";
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    const script = join(root, "scripts", "agent-catalog", "build-catalog.mjs");
    const result = spawnSync(process.execPath, [script, "--require-complete-probe"], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /native CLI versions.*do not match resolved candidate/s);
  });
});

test("complete probes reject missing agent-process attestation versions", () => {
  withFixture((root) => {
    alignProbeVersions(root);
    writeCompleteState(root);
    const snapshotPath = join(
      root,
      "scripts",
      "agent-catalog",
      "generated",
      "codex.openai-api.probe.json",
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    delete snapshot.attestation.version;
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    const script = join(root, "scripts", "agent-catalog", "build-catalog.mjs");
    const result = spawnSync(process.execPath, [script, "--require-complete-probe"], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /codex\.openai-api.*missing agent-process attestation version/s);
  });
});

test("complete probes reject missing native CLI versions for native pins", () => {
  withFixture((root) => {
    alignProbeVersions(root);
    writeCompleteState(root);
    const snapshotPath = join(
      root,
      "scripts",
      "agent-catalog",
      "generated",
      "codex.openai-api.probe.json",
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    delete snapshot.nativeCli.version;
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    const script = join(root, "scripts", "agent-catalog", "build-catalog.mjs");
    const result = spawnSync(process.execPath, [script, "--require-complete-probe"], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /codex\.openai-api.*missing native CLI version/s);
  });
});

test("partial probe state cannot build a promotable catalog", () => {
  withFixture((root) => {
    const logDir = join(root, "scripts", "agent-catalog", "generated", ".probe-logs");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "run.state"), "complete=false\n");
    const script = join(root, "scripts", "agent-catalog", "build-catalog.mjs");
    const result = spawnSync(process.execPath, [script, "--require-complete-probe"], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /partial or failed/);
  });
});
