-- Old-chain deletion (A9): drop the sqlite-backed gateway model probe store
-- (0051) that used to back the resolver chain (`catalog::gateway_resolver`,
-- deleted). It was keyed on the global `state.json` revision, so any
-- harness's auth change invalidated every harness's probe — the machine
-- model-snapshot document (`model-snapshot.json`, fingerprint-scoped per
-- (harness, auth context)) replaces it with no migration of its own: the
-- snapshot is derived state, populated fresh by the reconciler's pokes.
DROP INDEX IF EXISTS idx_gateway_model_probe_lookup;
DROP TABLE IF EXISTS gateway_model_probe;
