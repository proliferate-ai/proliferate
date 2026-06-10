#!/usr/bin/env node
// Render catalog.draft.json into a self-contained, searchable HTML viewer.
// Usage: node render-catalog.mjs   → writes catalog.html next to the draft.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "catalog.draft.json"), "utf8"));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Catalog ${catalog.catalogVersion}</title>
<style>
  :root {
    color-scheme: dark;
    --bg:#0b0e14; --panel:#11151d; --panel2:#161b26; --line:#222936; --line2:#1a202b;
    --text:#e8edf4; --dim:#8b96a5; --faint:#5c6675;
    --blue:#6cb6ff; --green:#4ade80; --amber:#fbbf24; --purple:#c4b5fd;
  }
  * { box-sizing:border-box; }
  body { font:14px/1.45 -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
         background:var(--bg); color:var(--text); margin:0; }
  .wrap { max-width:1180px; margin:0 auto; padding:28px 28px 80px; }

  header h1 { font-size:21px; font-weight:700; letter-spacing:-.02em; margin:0; }
  header h1 .v { color:var(--dim); font-weight:500; font-size:14px; margin-left:8px; }
  .meta { color:var(--faint); font-size:12.5px; margin:4px 0 18px; }

  .toolbar { position:sticky; top:0; z-index:5; background:linear-gradient(var(--bg) 85%, transparent);
             padding:10px 0 14px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  #search { flex:1; min-width:280px; max-width:560px; padding:10px 14px; font-size:14px;
            background:var(--panel2); border:1px solid var(--line); border-radius:10px; color:var(--text);
            outline:none; transition:border-color .15s; }
  #search:focus { border-color:var(--blue); }
  label.toggle { font-size:12.5px; color:var(--dim); display:flex; gap:6px; align-items:center;
                 cursor:pointer; user-select:none; }
  .stat { font-size:12.5px; color:var(--faint); margin-left:auto; }

  details.agent { border:1px solid var(--line); border-radius:14px; margin:14px 0;
                  background:var(--panel); overflow:hidden; }
  details.agent > summary { cursor:pointer; padding:14px 18px; display:flex; gap:12px;
                            align-items:center; flex-wrap:wrap; list-style:none; }
  details.agent > summary::-webkit-details-marker { display:none; }
  .dot { width:10px; height:10px; border-radius:50%; flex:none; }
  .aname { font-weight:700; font-size:15.5px; letter-spacing:-.01em; }
  .ver { color:var(--faint); font-size:12px; font-family:ui-monospace,monospace; }
  .badges { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-left:auto; }
  .badge { font-size:11px; padding:2px 9px; border-radius:999px; border:1px solid var(--line);
           background:var(--panel2); color:var(--dim); }
  .badge.vis { color:var(--green); border-color:#1f4430; }
  .badge.hid { color:var(--amber); border-color:#4a3a14; }
  .ctx { font-size:11px; padding:2px 9px; border-radius:999px; background:#19202c;
         border:1px solid var(--line); color:var(--blue); font-family:ui-monospace,monospace; }
  .caret { color:var(--faint); transition:transform .15s; flex:none; }
  details[open] > summary .caret { transform:rotate(90deg); }

  .universe { padding:0 18px 12px; color:var(--dim); font-size:12px; display:flex; gap:18px; flex-wrap:wrap; }
  .universe .u { background:var(--panel2); border:1px solid var(--line2); border-radius:8px; padding:5px 10px; }
  .universe .k { color:var(--blue); font-family:ui-monospace,monospace; }

  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--faint); font-weight:600; font-size:10.5px; text-transform:uppercase;
       letter-spacing:.06em; padding:8px 18px 8px; border-top:1px solid var(--line2); }
  td { padding:9px 18px; border-top:1px solid var(--line2); vertical-align:top; }
  tr.model:hover td { background:#141925; }
  tr.model.hidden { display:none; }
  .name { font-weight:600; font-size:13.5px; }
  .id { font-family:ui-monospace,monospace; font-size:11px; color:var(--faint); word-break:break-all; margin-top:1px; }
  .desc { color:var(--dim); font-size:11.5px; margin-top:2px; max-width:430px; }
  .chip { display:inline-block; font-size:10.5px; padding:1px 8px; border-radius:999px; margin:1px 3px 1px 0;
          border:1px solid var(--line); background:var(--panel2); color:var(--dim);
          font-family:ui-monospace,monospace; white-space:nowrap; }
  .chip.all { color:var(--green); border-color:#1f4430; }
  .vis-yes { color:var(--green); font-size:11.5px; font-weight:600; }
  .vis-no  { color:var(--amber); font-size:11.5px; font-weight:600; }
  .controls { font-size:12px; color:var(--dim); }
  .controls .row { margin:1px 0; }
  .controls .k { color:var(--blue); font-family:ui-monospace,monospace; font-size:11.5px; }
  .val { display:inline-block; background:var(--panel2); border:1px solid var(--line2); color:var(--text);
         border-radius:6px; padding:0 6px; font-size:11px; font-family:ui-monospace,monospace; margin:1px 2px; }
  .val.obs { border-color:var(--blue); color:var(--blue); }
  .trial { font-size:10px; color:var(--purple); border:1px solid #4c3a82; border-radius:999px;
           padding:1px 7px; margin-left:6px; cursor:help; }
  footer { color:var(--faint); font-size:11.5px; margin-top:28px; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Agent Catalog <span class="v">${catalog.catalogVersion} · schema v${catalog.schemaVersion}</span></h1>
  <div class="meta">generated ${catalog.generatedAt} — every row observed by a live probe run; "trial" rows
  were never on a menu but a seeded config + real inference turn proved them launchable.</div>
</header>
<div class="toolbar">
  <input id="search" type="search" placeholder="search models, ids, controls, contexts… (opus, xhigh, oauth, plan)">
  <label class="toggle"><input type="checkbox" id="visonly"> on-menu only</label>
  <span class="stat" id="stat"></span>
</div>
<div id="agents"></div>
<footer>source: scripts/agent-catalog/catalog.draft.json · regenerate with <code>node build-catalog.mjs && node render-catalog.mjs</code></footer>
</div>
<script>
const CATALOG = ${JSON.stringify(catalog)};
const ACCENTS = { claude:'#d97757', codex:'#74d4c0', cursor:'#c4b5fd', gemini:'#6cb6ff', opencode:'#4ade80' };
const TRIAL_TIP = 'Not on any advertised menu — availability proven by seeding the harness config with this id and completing a real inference turn.';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function controlCells(controls) {
  const rows = Object.entries(controls).map(([k, c]) =>
    '<div class="row"><span class="k">' + esc(k) + '</span> ' +
    c.values.map(v => '<span class="val' + (v === c.observedValue ? ' obs' : '') + '">' + esc(v) + '</span>').join('') +
    '</div>');
  return rows.join('') || '<span style="color:var(--faint)">—</span>';
}

function hay(m) {
  return [m.id, m.displayName, m.description, (m.availability.anyOf || []).join(' '),
    Object.entries(m.controls).map(([k, c]) => k + ' ' + c.values.join(' ')).join(' ')].join(' ').toLowerCase();
}

function render() {
  const root = document.getElementById('agents');
  root.innerHTML = '';
  for (const agent of CATALOG.agents) {
    const accent = ACCENTS[agent.kind] ?? '#8b96a5';
    const models = agent.session.models;
    const vis = models.filter(m => m.defaultVisible).length;
    const det = document.createElement('details');
    det.className = 'agent';
    det.innerHTML =
      '<summary><span class="caret">▸</span><span class="dot" style="background:' + accent + '"></span>' +
      '<span class="aname">' + esc(agent.displayName) + '</span>' +
      '<span class="ver">' + esc(agent.harness.agentProcess?.version ?? '?') + '</span>' +
      '<span class="badges"><span class="badge" data-count></span>' +
      '<span class="badge vis">' + vis + ' on menu</span>' +
      (models.length - vis ? '<span class="badge hid">' + (models.length - vis) + ' hidden</span>' : '') +
      agent.authContexts.map(c => '<span class="ctx">' + esc(c.id) + '</span>').join('') +
      '</span></summary>' +
      '<div class="universe">' + (agent.session.controls || []).filter(c => c.values).map(c =>
        '<span class="u"><span class="k">' + esc(c.key) + '</span> ' + c.values.map(esc).join(' · ') + '</span>').join('') +
      '</div>' +
      '<table><thead><tr><th style="width:30%">model</th><th style="width:8%">menu</th>' +
      '<th style="width:20%">availability</th><th>per-model controls</th></tr></thead><tbody>' +
      models.map(m => {
        const all = agent.authContexts.length && (m.availability.anyOf || []).length === agent.authContexts.length;
        return '<tr class="model" data-visible="' + m.defaultVisible + '" data-hay="' + esc(hay(m)) + '">' +
          '<td><span class="name">' + esc(m.displayName) + '</span>' +
          (m.provenance?.viaTrialOnly ? '<span class="trial" title="' + TRIAL_TIP + '">trial-verified</span>' : '') +
          '<div class="id">' + esc(m.id) + '</div>' +
          (m.description ? '<div class="desc">' + esc(m.description) + '</div>' : '') + '</td>' +
          '<td>' + (m.defaultVisible ? '<span class="vis-yes">on menu</span>' : '<span class="vis-no">hidden</span>') + '</td>' +
          '<td>' + (m.availability.anyOf || []).map(c =>
            '<span class="chip' + (all ? ' all' : '') + '">' + esc(c) + '</span>').join('') + '</td>' +
          '<td class="controls">' + controlCells(m.controls) + '</td></tr>';
      }).join('') + '</tbody></table>';
    root.appendChild(det);
  }
  applyFilter();
}

function applyFilter() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const visOnly = document.getElementById('visonly').checked;
  let shownTotal = 0, total = 0;
  for (const det of document.querySelectorAll('details.agent')) {
    let shown = 0, count = 0;
    for (const row of det.querySelectorAll('tr.model')) {
      count++;
      const ok = (!q || row.dataset.hay.includes(q)) && (!visOnly || row.dataset.visible === 'true');
      row.classList.toggle('hidden', !ok);
      if (ok) shown++;
    }
    det.querySelector('[data-count]').textContent =
      shown === count ? count + ' models' : shown + '/' + count + ' models';
    det.style.display = shown ? '' : 'none';
    det.open = (q || visOnly) ? shown > 0 : false;
    shownTotal += shown; total += count;
  }
  document.getElementById('stat').textContent =
    (q || visOnly ? shownTotal + ' of ' + total : total) + ' model rows · ' + CATALOG.agents.length + ' harnesses';
}

document.getElementById('search').addEventListener('input', applyFilter);
document.getElementById('visonly').addEventListener('change', applyFilter);
render();
</script>
</body>
</html>
`;

const out = join(here, "catalog.html");
writeFileSync(out, html);
console.log(`wrote ${out}`);
