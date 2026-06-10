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
<title>Agent Catalog ${catalog.catalogVersion}</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; background:#0d1117; color:#e6edf3; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .meta { color:#8b949e; font-size:12px; margin-bottom:16px; }
  #search { width:100%; max-width:520px; padding:8px 12px; font-size:14px; background:#161b22;
            border:1px solid #30363d; border-radius:8px; color:#e6edf3; margin-bottom:8px; }
  label.toggle { font-size:12px; color:#8b949e; margin-left:12px; user-select:none; }
  details.agent { border:1px solid #30363d; border-radius:10px; margin:10px 0; background:#161b22; }
  details.agent > summary { cursor:pointer; padding:10px 14px; font-weight:600; display:flex; gap:10px;
                            align-items:baseline; flex-wrap:wrap; }
  summary::-webkit-details-marker { color:#8b949e; }
  .ver { color:#8b949e; font-weight:400; font-size:12px; }
  .count { color:#58a6ff; font-weight:400; font-size:12px; }
  .ctx { font-size:11px; background:#1f2937; border:1px solid #30363d; padding:1px 7px; border-radius:999px; color:#9ca3af; }
  .universe { padding:0 14px 6px; color:#8b949e; font-size:12px; }
  .universe code { color:#c9d1d9; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#8b949e; font-weight:500; font-size:11px; text-transform:uppercase;
       letter-spacing:.04em; padding:6px 10px; border-top:1px solid #30363d; }
  td { padding:6px 10px; border-top:1px solid #21262d; vertical-align:top; }
  tr.model.hidden { display:none; }
  .id { font-family: ui-monospace, monospace; font-size:12px; color:#8b949e; word-break:break-all; }
  .name { font-weight:600; }
  .chip { display:inline-block; font-size:10px; padding:1px 6px; border-radius:999px; margin:1px 2px 1px 0;
          border:1px solid #30363d; background:#1f2937; color:#9ca3af; white-space:nowrap; }
  .chip.always { border-color:#238636; color:#3fb950; }
  .vis-yes { color:#3fb950; font-size:11px; }
  .vis-no  { color:#d29922; font-size:11px; }
  .controls { font-size:12px; }
  .controls .k { color:#58a6ff; }
  .controls .obs { color:#8b949e; }
  .trial { font-size:10px; color:#d2a8ff; border:1px solid #6e40c9; border-radius:999px; padding:0 6px; margin-left:4px; }
  .nores { color:#8b949e; padding:10px 14px; font-size:13px; }
</style>
</head>
<body>
<h1>Agent Catalog <span class="ver">${catalog.catalogVersion}</span></h1>
<div class="meta">generated ${catalog.generatedAt} · ${catalog.agents.length} harnesses ·
 ${catalog.agents.reduce((n, a) => n + a.session.models.length, 0)} model rows · schemaVersion ${catalog.schemaVersion}</div>
<input id="search" type="search" placeholder="search models, ids, controls, contexts… (e.g. opus, xhigh, oauth)" autofocus>
<label class="toggle"><input type="checkbox" id="visonly"> default-visible only</label>
<div id="agents"></div>
<script>
const CATALOG = ${JSON.stringify(catalog)};

function controlSummary(controls) {
  return Object.entries(controls).map(([k, c]) =>
    '<div><span class="k">' + k + '</span>: ' + c.values.join(' · ') +
    (c.observedValue ? ' <span class="obs">(observed: ' + c.observedValue + ')</span>' : '') + '</div>'
  ).join('') || '<span class="obs">—</span>';
}

function modelHaystack(m) {
  return [m.id, m.displayName, m.description, (m.availability.anyOf || []).join(' '),
          Object.entries(m.controls).map(([k, c]) => k + ' ' + c.values.join(' ')).join(' ')]
         .join(' ').toLowerCase();
}

function render() {
  const root = document.getElementById('agents');
  root.innerHTML = '';
  for (const agent of CATALOG.agents) {
    const det = document.createElement('details');
    det.className = 'agent';
    det.dataset.kind = agent.kind;
    const contexts = agent.authContexts.map(c => '<span class="ctx">' + c.id + '</span>').join(' ');
    const universe = (agent.session.controls || [])
      .filter(c => c.values)
      .map(c => '<code>' + c.key + '</code>: ' + c.values.join(' · ')).join(' &nbsp;|&nbsp; ');
    det.innerHTML =
      '<summary>' + agent.displayName +
      ' <span class="ver">adapter ' + (agent.harness.agentProcess?.version ?? '?') + '</span>' +
      ' <span class="count" data-count></span> ' + contexts + '</summary>' +
      (universe ? '<div class="universe">universe — ' + universe + '</div>' : '') +
      '<table><thead><tr><th style="width:26%">model</th><th style="width:10%">visible</th>' +
      '<th style="width:22%">availability</th><th>controls</th></tr></thead><tbody>' +
      agent.session.models.map(m => {
        const allCtx = agent.authContexts.length > 0 &&
          (m.availability.anyOf || []).length === agent.authContexts.length;
        const chips = (m.availability.anyOf || []).map(c =>
          '<span class="chip' + (allCtx ? ' always' : '') + '">' + c + '</span>').join('');
        return '<tr class="model" data-visible="' + m.defaultVisible + '" data-hay="' +
          modelHaystack(m).replaceAll('"', '&quot;') + '">' +
          '<td><div class="name">' + m.displayName +
          (m.provenance?.viaTrialOnly ? '<span class="trial">trial</span>' : '') +
          '</div><div class="id">' + m.id + '</div></td>' +
          '<td>' + (m.defaultVisible ? '<span class="vis-yes">on menu</span>' : '<span class="vis-no">hidden</span>') + '</td>' +
          '<td>' + chips + '</td>' +
          '<td class="controls">' + controlSummary(m.controls) + '</td></tr>';
      }).join('') + '</tbody></table>';
    root.appendChild(det);
  }
  applyFilter();
}

function applyFilter() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const visOnly = document.getElementById('visonly').checked;
  for (const det of document.querySelectorAll('details.agent')) {
    let shown = 0;
    for (const row of det.querySelectorAll('tr.model')) {
      const match = (!q || row.dataset.hay.includes(q)) && (!visOnly || row.dataset.visible === 'true');
      row.classList.toggle('hidden', !match);
      if (match) shown++;
    }
    const total = det.querySelectorAll('tr.model').length;
    det.querySelector('[data-count]').textContent = shown === total ? total + ' models' : shown + '/' + total + ' models';
    det.style.display = shown === 0 ? 'none' : '';
    if (q || visOnly) det.open = shown > 0; else det.open = false;
  }
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
