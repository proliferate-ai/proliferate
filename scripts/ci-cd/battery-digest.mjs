#!/usr/bin/env node
// The staging battery's morning digest (delivery/testing-cicd/delivery-spec-e2e-observable.md;
// specs/engineering/ci-cd/pipelines.md "Pipeline — nightly").
//
// Reads every qualification-evidence.json the runner wrote, groups the cells
// by verdict, and delivers ONE message: "staging battery N/M green · red: … ·
// expected-fail: … · blocked: …". Observe mode: this script never fails the
// job (exit 0 always) and never per-failure alerts — one digest, once. A run
// that produced no evidence (preflight skipped, runner crashed) still digests:
// NO RESULTS + the preflight note is itself the signal.
//
// Delivery chain (each failure falls through to the next): SLACK_WEBHOOK_URL →
// the pinned digest issue (GH_TOKEN + GITHUB_REPOSITORY; found via the search
// API so it never falls off a page and duplicates) → stdout.

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

/**
 * Parses report files, tolerating corrupt/partial ones (a cancelled job's
 * tree is not guaranteed): unreadable files become a note in the digest, not
 * a silent absence of the whole digest.
 */
export function readReports(files, readFile = (file) => readFileSync(file, "utf8")) {
  const reports = [];
  const unreadable = [];
  for (const file of files) {
    try {
      reports.push(JSON.parse(readFile(file)));
    } catch (error) {
      unreadable.push(`${path.basename(path.dirname(file))}/${path.basename(file)}: ${error instanceof Error ? error.message.slice(0, 80) : error}`);
    }
  }
  return { reports, unreadable };
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

/** The digest text. `note` carries e.g. the preflight-skip reason; `unreadable` lists corrupt reports. */
export function formatDigest(summary, { lane = "staging", runUrl = null, when = new Date(), note = "", unreadable = [] } = {}) {
  const day = when.toISOString().slice(0, 10);
  const header =
    summary.total === 0
      ? `${lane} battery ${day}: NO RESULTS — the runner produced no evidence (check the run).`
      : `${lane} battery ${day}: ${summary.green}/${summary.total} green`;
  const lines = [header];
  if (note && note.trim().length > 0) {
    lines.push(`note: ${oneLine(note)}`);
  }
  for (const entry of unreadable) {
    lines.push(`note: unreadable report — ${oneLine(entry)}`);
  }
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

/** The ordered delivery chain the environment allows. Pure, for tests. */
export function deliveryChain(env) {
  const chain = [];
  if (env.SLACK_WEBHOOK_URL?.trim()) {
    chain.push("slack");
  }
  if (env.GH_TOKEN?.trim() && env.GITHUB_REPOSITORY?.trim()) {
    chain.push("issue");
  }
  chain.push("stdout");
  return chain;
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

/**
 * Finds the pinned digest issue via the search API (title-scoped — never
 * falls off a page-1 listing and starts duplicating), falling back to a
 * paginated list scan when search is unavailable.
 */
async function findDigestIssue(api, title, headers, fetchImpl) {
  const query = encodeURIComponent(`repo:${api.repo} is:issue is:open in:title "${title}"`);
  const search = await fetchImpl(`https://api.github.com/search/issues?q=${query}&per_page=20`, { headers });
  if (search.ok) {
    const found = (await search.json()).items?.find((issue) => issue.title === title && !issue.pull_request);
    if (found) {
      return found;
    }
    return null;
  }
  for (let page = 1; page <= 5; page += 1) {
    const list = await fetchImpl(`${api.base}/issues?state=open&per_page=100&page=${page}`, { headers });
    if (!list.ok) {
      throw new Error(`issue list responded ${list.status}`);
    }
    const issues = await list.json();
    const found = issues.find((issue) => issue.title === title && !issue.pull_request);
    if (found) {
      return found;
    }
    if (issues.length < 100) {
      return null;
    }
  }
  return null;
}

async function deliverIssue(text, env, fetchImpl) {
  const repo = env.GITHUB_REPOSITORY.trim();
  const title = env.DIGEST_ISSUE_TITLE?.trim() || "Staging battery — morning digest";
  const api = { repo, base: `https://api.github.com/repos/${repo}` };
  const headers = {
    authorization: `Bearer ${env.GH_TOKEN}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "proliferate-battery-digest",
  };
  const body = `\`\`\`\n${text}\n\`\`\`\n\n_Replaced nightly by \`scripts/ci-cd/battery-digest.mjs\`. Observe mode: red blocks nothing; this is the triage queue._`;
  const existing = await findDigestIssue(api, title, headers, fetchImpl);
  const response = existing
    ? await fetchImpl(`${api.base}/issues/${existing.number}`, { method: "PATCH", headers, body: JSON.stringify({ body }) })
    : await fetchImpl(`${api.base}/issues`, { method: "POST", headers, body: JSON.stringify({ title, body }) });
  if (!response.ok) {
    throw new Error(`issue ${existing ? "update" : "create"} responded ${response.status}`);
  }
}

/**
 * Never throws: walks the delivery chain until one channel succeeds; the
 * digest is always echoed to stdout regardless.
 */
export async function deliver(text, env = process.env, fetchImpl = fetch) {
  console.log(text);
  const errors = [];
  for (const channel of deliveryChain(env)) {
    try {
      if (channel === "slack") {
        await deliverSlack(text, env, fetchImpl);
      } else if (channel === "issue") {
        await deliverIssue(text, env, fetchImpl);
      } else {
        if (errors.length > 0) {
          console.log(`[battery-digest] all channels failed (${errors.join("; ")}) — digest printed only.`);
        } else if (deliveryChain(env).length === 1) {
          console.log("[battery-digest] no SLACK_WEBHOOK_URL and no GH_TOKEN/GITHUB_REPOSITORY — digest printed only.");
        }
      }
      return { delivered: channel, errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${channel}: ${message}`);
      console.log(`[battery-digest] delivery via ${channel} failed (${message}) — trying the next channel.`);
    }
  }
  return { delivered: "stdout", errors };
}

function parseArgs(argv) {
  const args = { reports: "tests/release/.output", lane: "staging", runUrl: null, note: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reports") args.reports = argv[++i];
    else if (arg === "--lane") args.lane = argv[++i];
    else if (arg === "--run-url") args.runUrl = argv[++i];
    else if (arg === "--note") args.note = argv[++i];
  }
  return args;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const { reports, unreadable } = readReports(findReports(args.reports));
  const summary = summarizeReports(reports);
  const text = formatDigest(summary, {
    lane: args.lane,
    runUrl: args.runUrl,
    note: args.note || env.DIGEST_NOTE || "",
    unreadable,
  });
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
