-- Forks ADR R9 (rung 1c): adapter-migration marker.
--
-- Records the (adapter_version, native_version) pair a session was created or
-- attached under, so a session created against a pinned pre-migration adapter
-- (e.g. Claude 0.59.0-proliferate.1, Codex 0.18.3-proliferate.1) is
-- distinguishable at reattach from a canonical-migrated one (Claude
-- 0.66.0-proliferate.1, Codex 1.1.14-proliferate.1). The dual-read seam
-- (domains/sessions/adapter_migration.rs) reads this marker to decide an
-- explicit compatible load path or a typed, actionable incompatibility --
-- never a silent reinterpretation under the new metadata dialect.
--
-- Versions only: no credential facts or values are ever stored. NULL columns
-- mean the value was not resolvable at stamp time; an absent row means the
-- session predates the marker (treated as the pinned pre-migration floor).
CREATE TABLE session_adapter_markers (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    adapter_version TEXT,
    native_version TEXT,
    created_at TEXT NOT NULL
);
