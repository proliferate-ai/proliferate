#!/usr/bin/env node
// The staging battery's morning digest (delivery/testing-cicd/delivery-spec-e2e-observable.md;
// specs/engineering/ci-cd/pipelines.md "Pipeline — nightly").
//
// Reads every qualification-evidence.json the runner wrote, groups the cells
// by verdict, and delivers ONE message: "staging battery N/M green · red: … ·
// expected-fail: … · blocked: …". Observe mode: this script never fails the
// job (exit 0 always) and never per-failure alerts — one digest, once.
//
// Delivery: SLACK_WEBHOOK_URL when set (Block Kit-free plain text so every
// workspace renders it), else the pinned digest issue (created once, its body
// replaced nightly) via the GitHub REST API with GH_TOKEN + GITHUB_REPOSITORY.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const STATUS_ORDER = ["failed", "expected_fail", "blocked", "green", "cancelled", "not_run", "missing"];

/** Recursively finds every qualification-evidence.json under `root` (sorted for determinism). */
export function findReports(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = path.join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
      } else if (entry === "qualification-evidence.json") {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

/** One digest row per result cell across all reports, keyed by cell id (last report wins). */
export function summarizeReports(reports) {
  const cells = new Map();
  for (const report of reports) {
    for (const result of report.results ?? []) {
      cells.set(result.cell_id, {
        cellId: result.cell_id,
        scenarioId: result.scenario_id,
        status: result.status,
        reason: result.reason?.message ?? null,
      });
    }
  }
  const rows = [...cells.values()].sort((a, b) => a.cellId.localeCompare(b.cellId));
  const byStatus = {};
  for (const row of rows) {
    (byStatus[row.status] ??= []).push(row);
  }
  return { rows, byStatus, total: rows.length, green: (byStatus.green ?? []).length };
}

function oneLine(text, max = 160) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The digest text. `lane` and `runUrl` are context; everything else is the summary. */
export function formatDigest(summary, { lane = "staging", runUrl = null, when = new Date() } = {}) {
  const day = when.toISOString().slice(0, 10);
  const header =
    summary.total === 0
      ? `${lane} battery ${day}: NO RESULTS — the runner produced no evidence (check the run).`
      : `${lane} battery ${day}: ${summary.green}/${summary.total} green`;
  const lines = [header];
  const label = { failed: "RED", expected_fail: "expected-fail", blocked: "blocked", green: "green" };
  for (const status of STATUS_ORDER) {
    const rows = summary.byStatus[status] ?? [];
    if (rows.length === 0 || status === "green") {
      continue;
    }
    lines.push(`${label[status] ?? status} (${rows.length}):`);
    for (const row of rows) {
      lines.push(`  • ${row.cellId}${row.reason ? ` — ${oneLine(row.reason)}` : ""}`);
    }
  }
  const green = summary.byStatus.green ?? [];
  if (green.length > 0) {
    lines.push(`green (${green.length}): ${green.map((row) => row.cellId).join(", ")}`);
  }
  if (runUrl) {
    lines.push(`run: ${runUrl}`);
  }
  return lines.join("\n");
}

/** Which channel the digest goes to, from the environment. Pure, for tests. */
export function chooseDelivery(env) {
  if (env.SLACK_WEBHOOK_URL?.trim()) {
    return { kind: "slack" };
  }
  if (env.GH_TOKEN?.trim() && env.GITHUB_REPOSITORY?.trim()) {
    return { kind: "issue", repository: env.GITHUB_REPOSITORY.trim() };
  }
  return { kind: "stdout" };
}

async function deliverSlack(text, env, fetchImpl) {
  const response = await fetchImpl(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`slack webhook responded ${response.status}`);
  }
}

async function deliverIssue(text, env, fetchImpl) {
  const repo = env.GITHUB_REPOSITORY.trim();
  const title = env.DIGEST_ISSUE_TITLE?.trim() || "Staging battery — morning digest";
  const api = `https://api.github.com/repos/${repo}`;
  const headers = {
    authorization: `Bearer ${env.GH_TOKEN}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "proliferate-battery-digest",
  };
  const body = `\`\`\`\n${text}\n\`\`\`\n\n_Replaced nightly by \`scripts/ci-cd/battery-digest.mjs\`. Observe mode: red blocks nothing; this is the triage queue._`;
  const search = await fetchImpl(`${api}/issues?state=open&per_page=100&labels=`, { headers });
  if (!search.ok) {
    throw new Error(`issue list responded ${search.status}`);
  }
  const existing = (await search.json()).find((issue) => issue.title === title && !issue.pull_request);
  const response = existing
    ? await fetchImpl(`${api}/issues/${existing.number}`, { method: "PATCH", headers, body: JSON.stringify({ body }) })
    : await fetchImpl(`${api}/issues`, { method: "POST", headers, body: JSON.stringify({ title, body }) });
  if (!response.ok) {
    throw new Error(`issue ${existing ? "update" : "create"} responded ${response.status}`);
  }
}

/** Never throws: delivery problems are printed, and the digest is always echoed to stdout. */
export async function deliver(text, env = process.env, fetchImpl = fetch) {
  console.log(text);
  const target = chooseDelivery(env);
  try {
    if (target.kind === "slack") {
      await deliverSlack(text, env, fetchImpl);
    } else if (target.kind === "issue") {
      await deliverIssue(text, env, fetchImpl);
    } else {
      console.log("[battery-digest] no SLACK_WEBHOOK_URL and no GH_TOKEN/GITHUB_REPOSITORY — digest printed only.");
    }
    return { delivered: target.kind, error: null };
  } catch (error) {
    console.log(`[battery-digest] delivery via ${target.kind} failed: ${error instanceof Error ? error.message : error}`);
    return { delivered: target.kind, error: String(error) };
  }
}

function parseArgs(argv) {
  const args = { reports: "tests/release/.output", lane: "staging", runUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reports") args.reports = argv[++i];
    else if (arg === "--lane") args.lane = argv[++i];
    else if (arg === "--run-url") args.runUrl = argv[++i];
  }
  return args;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const reports = findReports(args.reports).map((file) => JSON.parse(readFileSync(file, "utf8")));
  const summary = summarizeReports(reports);
  const text = formatDigest(summary, { lane: args.lane, runUrl: args.runUrl });
  await deliver(text, env);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      // Observe mode: even an unexpected crash never reds the job.
      console.log(`[battery-digest] unexpected error: ${error instanceof Error ? error.stack : error}`);
      process.exit(0);
    });
}
