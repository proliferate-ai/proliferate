#!/usr/bin/env node
// Render catalog.draft.json into a self-contained, searchable HTML viewer.
// Usage: node render-catalog.mjs   → writes catalog.html next to the draft.
// Style: Poppins, Tailwind neutral palette, blue reserved for focus +
// observed values only.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "catalog.draft.json"), "utf8"));

// ── diff vs baseline (default: the draft committed on origin/main) ─────────
let DIFF_BASE = null;
let baseline = null;
// Default: diff against origin/main's committed draft; before it exists
// there (pre-merge), fall back to HEAD so local re-probes still diff.
for (const ref of [process.env.CATALOG_DIFF_BASE, "origin/main", "HEAD"].filter(Boolean)) {
  try {
    baseline = JSON.parse(execSync(
      `git show ${ref}:scripts/agent-catalog/catalog.draft.json`,
      { cwd: here, stdio: ["ignore", "pipe", "ignore"] },
    ).toString());
    DIFF_BASE = ref;
    break;
  } catch { /* try next ref */ }
}

function modelFingerprint(m) {
  return JSON.stringify({
    a: [...(m.availability.anyOf ?? [])].sort(),
    v: m.defaultVisible,
    c: Object.fromEntries(Object.entries(m.controls).map(([k, c]) => [k, [...c.values].sort()])),
  });
}

function describeChange(prev, cur) {
  const parts = [];
  const pa = new Set(prev.availability.anyOf ?? []), ca = new Set(cur.availability.anyOf ?? []);
  const aAdd = [...ca].filter((x) => !pa.has(x)), aDel = [...pa].filter((x) => !ca.has(x));
  if (aAdd.length || aDel.length)
    parts.push("availability " + [...aAdd.map((x) => "+" + x), ...aDel.map((x) => "−" + x)].join(" "));
  if (prev.defaultVisible !== cur.defaultVisible)
    parts.push(cur.defaultVisible ? "now on menu" : "left the menu");
  for (const key of new Set([...Object.keys(prev.controls), ...Object.keys(cur.controls)])) {
    const pv = new Set(prev.controls[key]?.values ?? []), cv = new Set(cur.controls[key]?.values ?? []);
    const add = [...cv].filter((x) => !pv.has(x)), del = [...pv].filter((x) => !cv.has(x));
    if (add.length || del.length)
      parts.push(key + " " + [...add.map((x) => "+" + x), ...del.map((x) => "−" + x)].join(" "));
  }
  return parts.join("; ");
}

// Annotate the catalog in place: m.diff = {status: 'new'|'changed', detail?}
// and agent.removedModels = rows present on the baseline but gone now.
if (baseline) {
  const baseAgents = new Map(baseline.agents.map((a) => [a.kind, a]));
  for (const agent of catalog.agents) {
    const baseModels = new Map((baseAgents.get(agent.kind)?.session.models ?? []).map((m) => [m.id, m]));
    for (const m of agent.session.models) {
      const prev = baseModels.get(m.id);
      if (!prev) m.diff = { status: "new" };
      else if (modelFingerprint(prev) !== modelFingerprint(m))
        m.diff = { status: "changed", detail: describeChange(prev, m) };
      baseModels.delete(m.id);
    }
    agent.removedModels = [...baseModels.values()];
  }
  for (const [kind, baseAgent] of baseAgents) {
    if (!catalog.agents.some((a) => a.kind === kind)) {
      catalog.agents.push({ ...baseAgent, session: { ...baseAgent.session, models: [] },
        removedModels: baseAgent.session.models, removedAgent: true });
    }
  }
}
const DIFF_INFO = baseline ? DIFF_BASE : null;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Catalog ${catalog.catalogVersion}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --n50:#fafafa; --n100:#f5f5f5; --n200:#e5e5e5; --n300:#d4d4d4;
    --n500:#737373; --n600:#525252; --n700:#404040; --n800:#262626; --n900:#171717;
    --b100:#dbeafe; --b600:#2563eb; --b700:#1d4ed8;
  }
  * { box-sizing:border-box; }
  body { font-family:"Poppins", -apple-system, sans-serif; font-size:13.5px; line-height:1.55;
         background:var(--n50); color:var(--n800); margin:0; }
  .mono { font-family:ui-monospace, "SF Mono", Menlo, monospace; }
  .wrap { max-width:1180px; margin:0 auto; padding:36px 28px 80px; }

  /* ── header ── */
  h1 { font-size:22px; font-weight:600; letter-spacing:-.01em; margin:0; color:var(--n900); }
  .sub { color:var(--n500); font-size:13px; margin-top:2px; }
  .stats { display:flex; gap:28px; margin:18px 0 6px; }
  .stats .s b { display:block; font-size:18px; font-weight:600; color:var(--n900); }
  .stats .s span { font-size:12px; color:var(--n500); }

  /* ── toolbar ── */
  .toolbar { position:sticky; top:0; z-index:5; background:linear-gradient(var(--n50) 82%, transparent);
             padding:12px 0 16px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  #search { flex:1; min-width:280px; max-width:520px; padding:10px 14px; font-size:13.5px;
            font-family:inherit; background:#fff; border:1px solid var(--n200); border-radius:10px;
            color:var(--n900); outline:none; }
  #search:focus { border-color:var(--b600); box-shadow:0 0 0 3px var(--b100); }
  #search::placeholder { color:var(--n500); }
  label.toggle { font-size:13px; color:var(--n600); display:flex; gap:7px; align-items:center;
                 cursor:pointer; user-select:none; }
  .stat { font-size:13px; color:var(--n500); margin-left:auto; }

  /* ── agent cards ── */
  details.agent { border:1px solid var(--n200); border-radius:14px; margin:14px 0;
                  background:#fff; overflow:hidden; }
  details.agent > summary { cursor:pointer; padding:16px 20px; display:flex; gap:14px;
                            align-items:center; list-style:none; }
  details.agent > summary:hover { background:var(--n50); }
  details.agent > summary::-webkit-details-marker { display:none; }
  .caret { color:var(--n500); font-size:10px; transition:transform .15s; flex:none; }
  details[open] > summary .caret { transform:rotate(90deg); }
  .aname { font-weight:600; font-size:15px; color:var(--n900); }
  .ver { color:var(--n500); font-size:12px; }
  .counts { margin-left:auto; font-size:12.5px; color:var(--n600); display:flex; gap:18px; }
  .counts b { font-weight:600; color:var(--n800); }

  .cardmeta { padding:0 20px 14px; border-bottom:1px solid var(--n100); }
  .metarow { display:flex; gap:10px; align-items:baseline; margin:6px 0; flex-wrap:wrap; }
  .metarow .lbl { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
                  color:var(--n500); width:104px; flex:none; }
  .tag { display:inline-block; font-size:12px; padding:2px 10px; border-radius:999px;
         background:var(--n100); color:var(--n700); margin:2px 4px 2px 0; }
  .tag .k { font-weight:600; color:var(--n800); }

  /* ── model table ── */
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--n500); font-weight:600; font-size:10.5px; text-transform:uppercase;
       letter-spacing:.07em; padding:10px 20px 8px; }
  td { padding:11px 20px; border-top:1px solid var(--n100); vertical-align:top; }
  tr.model:hover td { background:var(--n50); }
  tr.model.hidden { display:none; }
  tr.divider td { border-top:1px solid var(--n200); padding:7px 20px; font-size:11px; font-weight:600;
                  text-transform:uppercase; letter-spacing:.07em; color:var(--n500); background:var(--n50); }
  .name { font-weight:600; font-size:13.5px; color:var(--n900); }
  .id { font-size:11.5px; color:var(--n500); word-break:break-all; margin-top:2px; }
  .desc { color:var(--n600); font-size:12px; margin-top:3px; max-width:460px; }
  .pill { display:inline-block; font-size:11.5px; padding:1px 9px; border-radius:999px;
          background:var(--n100); color:var(--n700); margin:1px 3px 1px 0; white-space:nowrap; }
  .trial { font-size:11px; font-weight:500; color:var(--n700); background:var(--n100);
           border:1px solid var(--n200); border-radius:999px; padding:1px 9px; margin-left:8px; cursor:help; }
  .controls { display:grid; grid-template-columns:max-content 1fr; gap:2px 12px; }
  .controls .ck { font-size:12.5px; font-weight:500; color:var(--n900); }
  .controls .cv { font-size:12.5px; color:var(--n600); }
  .legend { color:var(--n500); font-size:12px; margin-top:26px; max-width:860px; }
  .legend b { color:var(--n700); }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Agent Catalog</h1>
  <div class="sub">${catalog.catalogVersion} · schema v${catalog.schemaVersion} · generated ${catalog.generatedAt.slice(0, 16).replace("T", " ")}${DIFF_INFO ? ` · diffed against ${DIFF_INFO}` : ""}</div>
  <div class="stats">
    <div class="s"><b>${catalog.agents.length}</b><span>harnesses</span></div>
    <div class="s"><b>${catalog.agents.reduce((n, a) => n + a.session.models.length, 0)}</b><span>model rows</span></div>
    <div class="s"><b>${catalog.agents.reduce((n, a) => n + a.authContexts.length, 0)}</b><span>auth contexts</span></div>
  </div>
</header>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search models, ids, controls, contexts…">
  <label class="toggle"><input type="checkbox" id="visonly"> on-menu only</label>
  <label class="toggle" id="diffonlywrap" style="display:none"><input type="checkbox" id="diffonly"> changes only</label>
  <span class="stat" id="stat"></span>
</div>
<div id="agents"></div>
<div class="legend">
  <b>On menu</b> — the harness advertises this model in its own picker under at least one probed auth context.
  &nbsp;·&nbsp; <b>Hidden</b> — never advertised, but a seeded config plus a completed inference turn proved it
  launchable (“trial-verified”). &nbsp;·&nbsp; <b>Available with</b> — exactly the auth contexts whose probe runs
  observed the model; nothing is inferred.
</div>
</div>
<script>
const CATALOG = ${JSON.stringify(catalog).replace(/<\//g, '<\\/')};
const TRIAL_TIP = 'Not on any advertised menu — availability proven by seeding the harness config with this id and completing a real inference turn.';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function controlCells(controls) {
  const rows = Object.entries(controls).map(([k, c]) =>
    '<span class="ck">' + esc(k) + '</span><span class="cv">' + c.values.map(esc).join(', ') + '</span>');
  return rows.join('') || '<span class="cv">none reported</span>';
}

function hay(m) {
  return [m.id, m.displayName, m.description, (m.availability.anyOf || []).join(' '),
    Object.entries(m.controls).map(([k, c]) => k + ' ' + c.values.join(' ')).join(' ')].join(' ').toLowerCase();
}

function diffChip(m) {
  if (m.removed) return '<span class="dchip removed">removed</span>';
  if (m.diff?.status === 'new') return '<span class="dchip new">new</span>';
  if (m.diff?.status === 'changed')
    return '<span class="dchip changed" title="' + esc(m.diff.detail || '') + '">changed</span>';
  return '';
}

function modelRow(agent, m) {
  return '<tr class="model' + (m.removed ? ' removedrow' : '') + '" data-visible="' + m.defaultVisible +
    '" data-diff="' + (m.removed ? 'removed' : (m.diff?.status ?? '')) + '" data-hay="' + esc(hay(m)) + '">' +
    '<td><span class="name">' + esc(m.displayName) + '</span>' + diffChip(m) +
    (m.provenance?.viaTrialOnly ? '<span class="trial" title="' + TRIAL_TIP + '">trial-verified</span>' : '') +
    '<div class="id mono">' + esc(m.id) + '</div>' +
    (m.description ? '<div class="desc">' + esc(m.description) + '</div>' : '') + '</td>' +
    '<td>' + (m.availability.anyOf || []).map(c => '<span class="pill mono">' + esc(c) + '</span>').join('') + '</td>' +
    '<td class="controls">' + controlCells(m.controls) + '</td></tr>';
}

function render() {
  const root = document.getElementById('agents');
  root.innerHTML = '';
  for (const agent of CATALOG.agents) {
    const models = agent.session.models;
    const onMenu = models.filter(m => m.defaultVisible);
    const hidden = models.filter(m => !m.defaultVisible);
    const removed = (agent.removedModels ?? []).map(m => ({ ...m, removed: true }));
    const det = document.createElement('details');
    det.className = 'agent';
    det.innerHTML =
      '<summary><span class="caret">▶</span>' +
      '<span class="aname">' + esc(agent.displayName) + '</span>' +
      '<span class="ver mono">' + esc(agent.harness.agentProcess?.version ?? '?') + '</span>' +
      '<span class="counts"><span data-count></span>' +
      '<span><b>' + onMenu.length + '</b> on menu</span>' +
      (hidden.length ? '<span><b>' + hidden.length + '</b> hidden</span>' : '') +
      (function(){
        const n = models.filter(m => m.diff?.status === 'new').length;
        const c = models.filter(m => m.diff?.status === 'changed').length;
        const r = removed.length;
        return (n || c || r) ? '<span class="dsum">' +
          [n && ('+' + n), c && ('~' + c), r && ('−' + r)].filter(Boolean).join(' ') + '</span>' : '';
      })() +
      '</span></summary>' +
      '<div class="cardmeta">' +
      '<div class="metarow"><span class="lbl">Auth contexts</span><span>' +
        agent.authContexts.map(c => '<span class="tag mono">' + esc(c.id) + '</span>').join('') + '</span></div>' +
      ((agent.session.controls || []).some(c => c.values) ?
        '<div class="metarow"><span class="lbl">Controls</span><span>' +
        agent.session.controls.filter(c => c.values).map(c =>
          '<span class="tag"><span class="k">' + esc(c.key) + '</span> ' + c.values.map(esc).join(' · ') + '</span>').join('') +
        '</span></div>' : '') +
      '</div>' +
      '<table><thead><tr><th style="width:34%">Model</th><th style="width:24%">Available with</th>' +
      '<th>Per-model controls</th></tr></thead><tbody>' +
      onMenu.map(m => modelRow(agent, m)).join('') +
      (hidden.length ? '<tr class="divider"><td colspan="3">Hidden — available but not advertised</td></tr>' : '') +
      hidden.map(m => modelRow(agent, m)).join('') +
      (removed.length ? '<tr class="divider"><td colspan="3">Removed since baseline</td></tr>' : '') +
      removed.map(m => modelRow(agent, m)).join('') +
      '</tbody></table>';
    root.appendChild(det);
  }
  applyFilter();
}

function applyFilter() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const visOnly = document.getElementById('visonly').checked;
  const diffOnly = document.getElementById('diffonly')?.checked;
  let shownTotal = 0, total = 0;
  for (const det of document.querySelectorAll('details.agent')) {
    let shown = 0, count = 0, hiddenShown = 0;
    for (const row of det.querySelectorAll('tr.model')) {
      count++;
      const ok = (!q || row.dataset.hay.includes(q))
        && (!visOnly || row.dataset.visible === 'true')
        && (!diffOnly || row.dataset.diff !== '');
      row.classList.toggle('hidden', !ok);
      if (ok) { shown++; if (row.dataset.visible !== 'true') hiddenShown++; }
    }
    const divider = det.querySelector('tr.divider');
    if (divider) divider.style.display = hiddenShown ? '' : 'none';
    det.querySelector('[data-count]').textContent =
      shown === count ? count + ' models' : shown + ' of ' + count;
    det.style.display = shown ? '' : 'none';
    det.open = (q || visOnly || diffOnly) ? shown > 0 : false;
    shownTotal += shown; total += count;
  }
  document.getElementById('stat').textContent =
    (q || visOnly ? shownTotal + ' of ' + total + ' shown' : '');
}

document.getElementById('search').addEventListener('input', applyFilter);
document.getElementById('visonly').addEventListener('change', applyFilter);
const hasDiff = CATALOG.agents.some(a => (a.removedModels?.length) || a.session.models.some(m => m.diff));
if (${DIFF_INFO ? "true" : "false"}) {
  document.getElementById('diffonlywrap').style.display = '';
  document.getElementById('diffonly').addEventListener('change', applyFilter);
  if (hasDiff) document.getElementById('diffonly').checked = true;
}
render();
</script>
</body>
</html>
`;

const out = join(here, "catalog.html");
writeFileSync(out, html);
console.log(`wrote ${out}`);
