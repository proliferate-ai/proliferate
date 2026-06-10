#!/usr/bin/env node
// Render catalog.draft.json into a self-contained, searchable HTML viewer.
// Usage: node render-catalog.mjs   → writes catalog.html next to the draft.
// Palette: Tailwind neutral + blue, light.

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
  /* Tailwind neutral + blue */
  :root {
    --n50:#fafafa; --n100:#f5f5f5; --n200:#e5e5e5; --n300:#d4d4d4; --n400:#a3a3a3;
    --n500:#737373; --n600:#525252; --n700:#404040; --n800:#262626; --n900:#171717;
    --b50:#eff6ff; --b100:#dbeafe; --b200:#bfdbfe; --b600:#2563eb; --b700:#1d4ed8;
  }
  * { box-sizing:border-box; }
  body { font:14px/1.5 -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
         background:var(--n50); color:var(--n900); margin:0; }
  .wrap { max-width:1180px; margin:0 auto; padding:32px 28px 80px; }

  header h1 { font-size:20px; font-weight:650; letter-spacing:-.02em; margin:0; }
  header h1 .v { color:var(--n400); font-weight:450; font-size:13px; margin-left:8px; }
  .meta { color:var(--n500); font-size:13px; margin:6px 0 20px; max-width:760px; }

  .toolbar { position:sticky; top:0; z-index:5; background:linear-gradient(var(--n50) 80%, transparent);
             padding:8px 0 16px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  #search { flex:1; min-width:280px; max-width:540px; padding:9px 14px; font-size:14px;
            background:#fff; border:1px solid var(--n200); border-radius:8px; color:var(--n900);
            outline:none; box-shadow:0 1px 2px rgb(0 0 0 / .04); }
  #search:focus { border-color:var(--b600); box-shadow:0 0 0 3px var(--b100); }
  #search::placeholder { color:var(--n400); }
  label.toggle { font-size:13px; color:var(--n600); display:flex; gap:6px; align-items:center;
                 cursor:pointer; user-select:none; }
  .stat { font-size:13px; color:var(--n400); margin-left:auto; }

  details.agent { border:1px solid var(--n200); border-radius:12px; margin:14px 0;
                  background:#fff; overflow:hidden; box-shadow:0 1px 2px rgb(0 0 0 / .04); }
  details.agent > summary { cursor:pointer; padding:14px 18px; display:flex; gap:12px;
                            align-items:center; flex-wrap:wrap; list-style:none; }
  details.agent > summary:hover { background:var(--n50); }
  details.agent > summary::-webkit-details-marker { display:none; }
  .caret { color:var(--n400); font-size:11px; transition:transform .15s; flex:none; }
  details[open] > summary .caret { transform:rotate(90deg); }
  .aname { font-weight:650; font-size:15px; letter-spacing:-.01em; }
  .ver { color:var(--n400); font-size:12px; font-family:ui-monospace,monospace; }
  .badges { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-left:auto; }
  .badge { font-size:11.5px; padding:2px 9px; border-radius:999px; background:var(--n100); color:var(--n600); }
  .badge.vis { background:var(--b50); color:var(--b700); }
  .ctx { font-size:11px; padding:2px 9px; border-radius:999px; background:#fff;
         border:1px solid var(--n200); color:var(--n500); font-family:ui-monospace,monospace; }

  .universe { padding:2px 18px 12px; color:var(--n500); font-size:12px; display:flex; gap:10px; flex-wrap:wrap; }
  .universe .u { background:var(--n50); border:1px solid var(--n100); border-radius:8px; padding:4px 10px; }
  .universe .k { color:var(--n700); font-weight:600; font-family:ui-monospace,monospace; }

  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--n400); font-weight:550; font-size:10.5px; text-transform:uppercase;
       letter-spacing:.06em; padding:8px 18px; border-top:1px solid var(--n100); }
  td { padding:10px 18px; border-top:1px solid var(--n100); vertical-align:top; }
  tr.model:hover td { background:var(--n50); }
  tr.model.hidden { display:none; }
  .name { font-weight:600; font-size:13.5px; color:var(--n900); }
  .id { font-family:ui-monospace,monospace; font-size:11px; color:var(--n400); word-break:break-all; margin-top:2px; }
  .desc { color:var(--n500); font-size:12px; margin-top:2px; max-width:430px; }
  .chip { display:inline-block; font-size:10.5px; padding:1px 8px; border-radius:999px; margin:1px 3px 1px 0;
          background:var(--n100); color:var(--n600); font-family:ui-monospace,monospace; white-space:nowrap; }
  .chip.all { background:var(--b50); color:var(--b700); }
  .vis-yes { color:var(--b700); font-size:12px; font-weight:600; }
  .vis-no  { color:var(--n400); font-size:12px; font-weight:500; }
  .controls { font-size:12px; color:var(--n600); }
  .controls .row { margin:2px 0; }
  .controls .k { color:var(--n500); font-family:ui-monospace,monospace; font-size:11px; margin-right:2px; }
  .val { display:inline-block; background:var(--n100); color:var(--n700);
         border-radius:6px; padding:0 7px; font-size:11px; font-family:ui-monospace,monospace; margin:1px 2px; }
  .val.obs { background:var(--b100); color:var(--b700); }
  .trial { font-size:10px; color:var(--b700); background:var(--b50); border-radius:999px;
           padding:1px 8px; margin-left:6px; cursor:help; }
  footer { color:var(--n400); font-size:12px; margin-top:28px; }
  footer code { background:var(--n100); padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Agent Catalog <span class="v">${catalog.catalogVersion} · schema v${catalog.schemaVersion}</span></h1>
  <div class="meta">Generated ${catalog.generatedAt}. Every row was observed by a live probe run;
  “trial-verified” rows were never on a menu but a seeded config + real inference turn proved them launchable.</div>
</header>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search models, ids, controls, contexts… (opus, xhigh, oauth, plan)">
  <label class="toggle"><input type="checkbox" id="visonly"> on-menu only</label>
  <span class="stat" id="stat"></span>
</div>
<div id="agents"></div>
<footer>source: scripts/agent-catalog/catalog.draft.json · regenerate with <code>node build-catalog.mjs && node render-catalog.mjs</code></footer>
</div>
<script>
const CATALOG = ${JSON.stringify(catalog)};
const TRIAL_TIP = 'Not on any advertised menu — availability proven by seeding the harness config with this id and completing a real inference turn.';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function controlCells(controls) {
  const rows = Object.entries(controls).map(([k, c]) =>
    '<div class="row"><span class="k">' + esc(k) + '</span> ' +
    c.values.map(v => '<span class="val' + (v === c.observedValue ? ' obs' : '') + '">' + esc(v) + '</span>').join('') +
    '</div>');
  return rows.join('') || '<span style="color:var(--n300)">—</span>';
}

function hay(m) {
  return [m.id, m.displayName, m.description, (m.availability.anyOf || []).join(' '),
    Object.entries(m.controls).map(([k, c]) => k + ' ' + c.values.join(' ')).join(' ')].join(' ').toLowerCase();
}

function render() {
  const root = document.getElementById('agents');
  root.innerHTML = '';
  for (const agent of CATALOG.agents) {
    const models = agent.session.models;
    const vis = models.filter(m => m.defaultVisible).length;
    const det = document.createElement('details');
    det.className = 'agent';
    det.innerHTML =
      '<summary><span class="caret">▶</span>' +
      '<span class="aname">' + esc(agent.displayName) + '</span>' +
      '<span class="ver">' + esc(agent.harness.agentProcess?.version ?? '?') + '</span>' +
      '<span class="badges"><span class="badge" data-count></span>' +
      '<span class="badge vis">' + vis + ' on menu</span>' +
      (models.length - vis ? '<span class="badge">' + (models.length - vis) + ' hidden</span>' : '') +
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
