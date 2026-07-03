-- Gateway model probe results (spec §2): what the LiteLLM gateway's
-- `GET /v1/models` returned for a harness, keyed by the state.json revision
-- whose credentials were used. The runtime resolves the latest row for
-- (harness_kind, revision) into a launch model plan; a missing row falls back
-- to the catalog seed models.
CREATE TABLE IF NOT EXISTS gateway_model_probe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    harness_kind TEXT NOT NULL,
    revision INTEGER NOT NULL,
    models_json TEXT NOT NULL,
    probed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gateway_model_probe_lookup
    ON gateway_model_probe(harness_kind, revision, probed_at);
