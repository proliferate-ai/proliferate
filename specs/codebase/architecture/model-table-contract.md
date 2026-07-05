# All-Models Table — Pinned Contract (build agents)

> Replaces the card grid in the All-Models tab with a rich table (names +
> thinking levels etc.), per the design-system reference. Decisions locked
> with Pablo 2026-07-03: no pricing/context columns, no `mode` column,
> design-system table = exact spec, sparse rows for unknown models,
> All-Models tab only (org agent-policy grid untouched), read-mostly
> (enable toggle stays), component lives in product-ui.

## 1. Data enrichment (runtime is the join point)

The bundled catalog v2 already stores what the table needs per model:
`displayName`, `description`, `status`, `controls.effort.{values, observedValue}`,
`controls.fast_mode`. Gateway probes return bare ids. The JOIN happens in the
runtime's HTTP layer (NOT in GatewayModelPlan — render still consumes plain ids):

- `GET /v1/agents/{kind}/catalog/gateway-models`: `models` entries become
  objects `{ id, displayName?, description?, provider?, status?,
  effort?: { values: string[], default?: string }, fastMode?: boolean }`
  — joined from the bundled catalog entry with the same id; probe-only ids
  (proxy serves it, catalog doesn't know it) emit `{ id, provider? }` only.
  `provider` comes from the existing id-prefix matcher in the gateway
  resolver (claude-*→anthropic, gpt-*→openai, grok-*→xai); omit when unmatched.
  Keep `source` (seed|probe) + `probedAt` at the top level as today.
- Native/api_key path (#912 upload): the launch-options response and the
  desktop's `buildRuntimeCatalogModelsJson` carry the same enriched fields,
  so cloud snapshots store rich rows too (server `parse_models_json` already
  accepts arbitrary keys beside `id` — verify, don't assume).
- Mirror push inherits richness automatically (it forwards the same rows).
- anyharness SDK regenerated; the desktop's hand-usable types extended.

## 2. The table (product-ui)

- New `ModelTable` in `packages/product-ui/src/settings/` styled EXACTLY per
  the table treatment in `~/proliferate/design-system/Design System Preview.html`
  (find the table/list section there; mirror structure, spacing, chip and
  badge styling, mono-dark tokens; adapt tokens to product-ui's existing
  token system rather than hardcoding hex where a token exists).
- Columns: **Model** (displayName, dim monospace id beneath/beside) ·
  **Provider** · **Thinking** (effort value chips, default value visually
  highlighted) · **Fast mode** (on/off badge or "—") · **Status** ·
  **Enabled** (switch, right-aligned).
- Sparse rows (probe-only models): Model = id, Provider if matched, all
  other cells "—". No hiding, no toggle.
- Table must scroll inside its own container on narrow widths (no page
  horizontal scroll); row hover + disabled-row treatment per the reference.
- `ModelConfigGrid` stays (org agent-policy still uses it). Only
  `HarnessAllModelsSection` switches to `ModelTable`.

## 3. Desktop wiring

- `HarnessAllModelsSection` maps the enriched runtime/cloud rows to
  `ModelTable` rows for BOTH paths (local+gateway = runtime endpoint;
  cloud / native routes = layered cloud catalog, whose snapshots now carry
  the enriched fields after a refresh; old thin snapshots render sparse).
- Enable/disable keeps the existing override patch flow untouched.
- Freshness line (probed/seed + Refresh button) unchanged.

## 4. Gates

cargo check/test workspace · anyharness SDK regen idempotent + sdk/sdk-react
tests · product-ui build + its tests · desktop `tsc --noEmit` + touched
tests · mobile typecheck · repo-shape suite (max-lines ratchet!).

## 5. Round-2 addendum (locked 2026-07-03, after real-data review)

- **Modes column IS in** (reverses §2's exclusion; Pablo's call after seeing the
  reference side-by-side): `GatewayModelEntry` + launch-options entries gain
  `modes?: string[]` from `controls.mode.values`; ModelTable renders them as
  quiet pills after Thinking, per the reference's Modes treatment.
- **Fix the enrichment join** (real-data finding: zero id overlap between
  catalog ids and gateway ids): join on a conservative FAMILY key —
  normalize(id) strips the `us.anthropic.` / `global.anthropic.` vendor
  prefixes, `[1m]` suffixes, `-vN:M` suffixes, and trailing `-YYYYMMDD` dates,
  lowercased. Gateway ids normalize the same way. Pure CLI selector ids
  (`default`, `sonnet`, `opus`) stay unbridged in v1 (no guessy displayName
  matching). Ambiguous family matches prefer the non-`[1m]`, most-specific
  entry. Unit tests with the REAL id sets from catalog.json + config.yaml.
- **Subtitle becomes description** when present (id moves to a title/hover
  attribute); id remains the subtitle only when no description exists.
- **Status column dropped** until non-`active` statuses actually occur
  (today it renders 18 identical green pills; also serves mono-color
  discipline). The status field stays on the wire.
- Review loop: screenshots re-rendered from the WORKTREE and approved by
  Pablo BEFORE the PR merges this round.
