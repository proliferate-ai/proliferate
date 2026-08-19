import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readIntent } from "./verify-harness-launch-options.mjs";

test("readIntent reads the validated session id with one embedded sqlite query", () => {
  const root = mkdtempSync(join(tmpdir(), "launch-options-intent-"));
  try {
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, "db.sqlite");
    execFileSync("sqlite3", [
      dbPath,
      "CREATE TABLE session_launch_intents (session_id TEXT PRIMARY KEY, requested_model_id TEXT, requested_controls_json TEXT);" +
        "INSERT INTO session_launch_intents VALUES ('session-123', 'gpt-5.2-codex', '{\"mode\":\"agent-full-access\"}');",
    ]);

    assert.deepEqual(readIntent(root, "session-123"), {
      modelId: "gpt-5.2-codex",
      controlValues: { mode: "agent-full-access" },
    });
    assert.throws(
      () => readIntent(root, "unsafe'session"),
      (error) => error?.code === "INVALID_SESSION_ID",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
