import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/catalog-probe.yml", import.meta.url),
  "utf8",
);
const runbook = readFileSync(
  new URL("../../specs/developing/operating/catalog-probe.md", import.meta.url),
  "utf8",
);

const requiredSecrets = [
  ["CATALOG_PROBE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
  ["CATALOG_PROBE_CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  ["CATALOG_PROBE_OPENAI_API_KEY", "OPENAI_API_KEY"],
  ["CATALOG_PROBE_CODEX_AUTH_JSON_B64", "CODEX_AUTH_JSON_B64"],
  ["CATALOG_PROBE_AWS_BEARER_TOKEN_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK"],
  ["CATALOG_PROBE_GEMINI_API_KEY", "GEMINI_API_KEY"],
  ["CATALOG_PROBE_OPENCODE_API_KEY", "OPENCODE_API_KEY"],
  ["CATALOG_PROBE_XAI_API_KEY", "XAI_API_KEY"],
];

test("Catalog Probe binds credentials to the protected lifecycle gate", () => {
  assert.match(workflow, /environment:\n\s+name: Catalog Probe\n/);
  assert.match(workflow, /CREDENTIALS_APPROVED: \$\{\{ vars\.CATALOG_PROBE_CREDENTIALS_APPROVED \}\}/);
  assert.match(workflow, /CREDENTIAL_OWNER: \$\{\{ vars\.CATALOG_PROBE_CREDENTIAL_OWNER \}\}/);
  assert.match(workflow, /ROTATION_DUE: \$\{\{ vars\.CATALOG_PROBE_ROTATION_DUE \}\}/);

  for (const [secret, injectedVariable] of requiredSecrets) {
    const references = workflow.match(new RegExp(`secrets\\.${secret}`, "g")) ?? [];
    assert.equal(references.length, 1, `${secret} must have one step-scoped reference`);
    assert.ok(runbook.includes("`" + secret + "`"), `${secret} must be in the runbook`);
    assert.match(workflow, new RegExp(`${injectedVariable}: \\$\\{\\{ secrets\\.${secret} \\}\\}`));
    assert.doesNotMatch(workflow, new RegExp(`secrets\\.${injectedVariable}(?:[^A-Z0-9_]|$)`));
  }
});

test("provider credentials and repository write permission stay in separate jobs", () => {
  const publishStart = workflow.indexOf("\n  publish:");
  const alertStart = workflow.indexOf("\n  alert:");
  assert.notEqual(publishStart, -1);
  assert.notEqual(alertStart, -1);

  const probeJob = workflow.slice(0, publishStart);
  const publishJob = workflow.slice(publishStart, alertStart);
  assert.doesNotMatch(probeJob, /contents: write|pull-requests: write/);
  assert.match(publishJob, /contents: write/);
  assert.match(publishJob, /pull-requests: write/);
  assert.doesNotMatch(publishJob, /secrets\.(ANTHROPIC|CLAUDE|OPENAI|CODEX|AWS|GEMINI|OPENCODE|XAI)/);
});

test("only sanitized catalog outputs cross into the publish job", () => {
  assert.match(workflow, /name: catalog-probe-output/);
  assert.match(workflow, /scripts\/agent-catalog\/generated\/\*\.probe\.json/);
  assert.doesNotMatch(workflow, /path:[^\n]*\.probe-logs/);
  assert.match(
    workflow,
    /if \[\[ -n "\$\{PROBE_CODEX_OAUTH_AUTH_JSON:-\}" \]\]; then\n\s+rm -f "\$PROBE_CODEX_OAUTH_AUTH_JSON"/,
  );
});

test("scheduled failures have a deduplicated owned issue path", () => {
  assert.match(workflow, /github\.event_name == 'schedule'/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /ops\(agent-catalog\): Catalog Probe scheduled failure/);
  const createIndex = workflow.indexOf("issue_url=$(gh issue create");
  const assignIndex = workflow.indexOf("if ! gh issue edit");
  assert.notEqual(createIndex, -1);
  assert.ok(assignIndex > createIndex, "alert issue must exist before assignment is attempted");
  assert.match(workflow, /--add-assignee pablonyx/);
  assert.doesNotMatch(workflow.slice(createIndex, assignIndex), /--assignee/);
});
