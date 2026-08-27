-- table: _migrations
CREATE TABLE _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

-- table: activity_processes
CREATE TABLE activity_processes (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    process_id TEXT NOT NULL,
    command TEXT NOT NULL,
    cwd TEXT,
    status TEXT NOT NULL,
    exit_code INTEGER,
    pid INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    feed_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, process_id)
);

-- table: activity_subagents
CREATE TABLE activity_subagents (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    subagent_id TEXT NOT NULL,
    agent_type TEXT,
    description TEXT,
    model TEXT,
    background INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    summary TEXT,
    tokens_used INTEGER,
    tool_calls INTEGER,
    duration_seconds INTEGER,
    feed_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, subagent_id)
);

-- table: agent_model_registry_snapshots
CREATE TABLE agent_model_registry_snapshots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    workspace_id TEXT,
    workspace_scope TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    refreshed_at TEXT NOT NULL,
    expires_at TEXT,
    models_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(kind, workspace_scope)
);

-- table: cowork_managed_workspaces
CREATE TABLE cowork_managed_workspaces (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    label TEXT,
    created_at TEXT NOT NULL, public_id TEXT, closed_at TEXT,
    UNIQUE(parent_session_id, workspace_id),
    UNIQUE(workspace_id)
);

-- table: cowork_roots
CREATE TABLE cowork_roots (
    id TEXT PRIMARY KEY CHECK (id = 'cowork-root'),
    repo_root_id TEXT NOT NULL UNIQUE REFERENCES repo_roots(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: cowork_threads
CREATE TABLE cowork_threads (
    id TEXT PRIMARY KEY,
    repo_root_id TEXT NOT NULL REFERENCES repo_roots(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    agent_kind TEXT NOT NULL,
    requested_model_id TEXT,
    branch_name TEXT NOT NULL,
    created_at TEXT NOT NULL
, workspace_delegation_enabled INTEGER NOT NULL DEFAULT 1);

-- table: execution_store_identity
CREATE TABLE execution_store_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    execution_store_id TEXT NOT NULL UNIQUE
);

-- table: feed_bindings
CREATE TABLE feed_bindings (
    feed_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    transport_kind TEXT NOT NULL,
    transport_path TEXT,
    transport_thread_id TEXT,
    transport_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: fork_operations
CREATE TABLE fork_operations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_digest TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT NOT NULL UNIQUE,
    phase TEXT NOT NULL CHECK (phase IN (
        'prepared',
        'native_call_in_flight',
        'native_result_known',
        'native_outcome_unknown',
        'child_persisted',
        'completed',
        'failed'
    )),
    anchor_turn_id TEXT,
    anchor_item_id TEXT,
    provider_anchor_kind TEXT,
    provider_anchor_value TEXT,
    provider_anchor_inclusive INTEGER,
    prefix_terminal_seq INTEGER,
    prefix_digest TEXT,
    adapter_version TEXT,
    native_version TEXT,
    native_child_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
, checkpoint_id TEXT);

-- table: goals
CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    native_status TEXT,
    token_budget INTEGER,
    tokens_used INTEGER,
    time_used_seconds INTEGER,
    met_reason TEXT,
    iterations INTEGER,
    native INTEGER NOT NULL DEFAULT 1,
    pending_op TEXT,
    revision INTEGER NOT NULL,
    native_state_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: harness_launch_option_states
CREATE TABLE harness_launch_option_states (
    harness_kind TEXT PRIMARY KEY,
    basis_revision TEXT NOT NULL,
    revision INTEGER NOT NULL,
    options_json TEXT,
    observed_at TEXT,
    probe_state TEXT NOT NULL
      CHECK (probe_state IN ('probing', 'succeeded', 'failed')),
    probe_attempted_at TEXT NOT NULL,
    probe_failure_code TEXT,
    CHECK ((options_json IS NULL) = (observed_at IS NULL)),
    CHECK (probe_state <> 'succeeded' OR options_json IS NOT NULL),
    CHECK ((probe_state = 'failed') = (probe_failure_code IS NOT NULL))
);

-- table: local_materialization_operation
CREATE TABLE local_materialization_operation (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('repo_root', 'workspace')),
    request_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
    -- Recorded when the clone path is chosen (repo-root acquisition), so a
    -- crash between clone and registration recovers as a `managed` root rather
    -- than being downgraded to `external` adoption. NULL for adoption/workspace.
    intended_kind TEXT CHECK (intended_kind IN ('managed', 'external')),
    repo_root_id TEXT,
    workspace_id TEXT,
    destination_path TEXT,
    observed_head_sha TEXT,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: loops
CREATE TABLE loops (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    loop_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule_kind TEXT NOT NULL,
    schedule_expr TEXT NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    native INTEGER NOT NULL DEFAULT 1,
    last_fired_at_ms INTEGER,
    fire_count INTEGER NOT NULL DEFAULT 0,
    native_state_json TEXT,
    created_at TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL, max_fires INTEGER, next_fire_at_ms INTEGER,
    PRIMARY KEY (session_id, loop_id)
);

-- table: mobility_archive_installs
CREATE TABLE mobility_archive_installs (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    source_workspace_path TEXT NOT NULL,
    base_commit_sha TEXT NOT NULL,
    imported_session_ids_json TEXT NOT NULL,
    applied_file_count INTEGER NOT NULL DEFAULT 0,
    deleted_file_count INTEGER NOT NULL DEFAULT 0,
    imported_agent_artifact_count INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    PRIMARY KEY (workspace_id, operation_id)
);

-- table: opencode_message_ids
CREATE TABLE opencode_message_ids (
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    vendor_message_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_id, item_id)
);

-- table: plan_handoffs
CREATE TABLE plan_handoffs (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    instruction TEXT NOT NULL,
    prompt_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: plan_interaction_links
CREATE TABLE plan_interaction_links (
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    resolution_state TEXT NOT NULL,
    option_mappings_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, request_id)
);

-- table: plans
CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    decision_state TEXT NOT NULL,
    native_resolution_state TEXT NOT NULL,
    decision_version INTEGER NOT NULL,
    source_agent_kind TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    source_turn_id TEXT,
    source_item_id TEXT,
    source_tool_call_id TEXT,
    superseded_by_plan_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: repo_roots
CREATE TABLE repo_roots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    display_name TEXT,
    default_branch TEXT,
    remote_provider TEXT,
    remote_owner TEXT,
    remote_repo_name TEXT,
    remote_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: review_assignments
CREATE TABLE review_assignments (
    id TEXT PRIMARY KEY,
    review_run_id TEXT NOT NULL,
    review_round_id TEXT NOT NULL,
    reviewer_session_id TEXT,
    session_link_id TEXT,
    persona_id TEXT NOT NULL,
    persona_label TEXT NOT NULL,
    persona_prompt TEXT NOT NULL,
    agent_kind TEXT NOT NULL,
    model_id TEXT,
    requested_mode_id TEXT,
    actual_mode_id TEXT,
    mode_verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (mode_verification_status IN ('pending', 'verified', 'mismatch', 'not_checked')),
    status TEXT NOT NULL CHECK (status IN (
        'queued',
        'launching',
        'reviewing',
        'reminded',
        'retryable_failed',
        'submitted',
        'cancelled',
        'timed_out',
        'system_failed'
    )),
    pass INTEGER,
    summary TEXT,
    critique_markdown TEXT,
    critique_artifact_path TEXT,
    submitted_at TEXT,
    deadline_at TEXT NOT NULL,
    reminder_count INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    failure_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, control_values_json TEXT NOT NULL DEFAULT '{}', launch_verification_status TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(review_round_id) REFERENCES review_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewer_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY(session_link_id) REFERENCES session_links(id) ON DELETE SET NULL
);

-- table: review_feedback_jobs
CREATE TABLE review_feedback_jobs (
    id TEXT PRIMARY KEY,
    review_run_id TEXT NOT NULL,
    review_round_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'failed')),
    prompt_text TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    sent_prompt_seq INTEGER,
    feedback_turn_id TEXT,
    failure_reason TEXT,
    failure_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(review_round_id) REFERENCES review_rounds(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- table: review_rounds
CREATE TABLE review_rounds (
    id TEXT PRIMARY KEY,
    review_run_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'reviewing',
        'completing',
        'passed',
        'feedback_pending',
        'feedback_sent',
        'completed_with_drift',
        'cancelled',
        'system_failed'
    )),
    target_plan_id TEXT,
    target_plan_snapshot_hash TEXT,
    target_code_manifest_json TEXT,
    feedback_job_id TEXT,
    feedback_prompt_sent_at TEXT,
    completed_at TEXT,
    failure_reason TEXT,
    failure_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(target_plan_id) REFERENCES plans(id) ON DELETE SET NULL,
    UNIQUE(review_run_id, round_number)
);

-- table: review_run_candidate_plans
CREATE TABLE review_run_candidate_plans (
    review_run_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    source_turn_id TEXT,
    source_tool_call_id TEXT,
    snapshot_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(review_run_id, plan_id),
    FOREIGN KEY(review_run_id) REFERENCES review_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

-- table: review_runs
CREATE TABLE review_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('plan', 'code')),
    status TEXT NOT NULL CHECK (status IN (
        'reviewing',
        'feedback_ready',
        'parent_revising',
        'waiting_for_revision',
        'passed',
        'stopped',
        'system_failed'
    )),
    target_plan_id TEXT,
    target_plan_snapshot_hash TEXT,
    target_code_manifest_json TEXT,
    title TEXT NOT NULL,
    max_rounds INTEGER NOT NULL,
    auto_iterate INTEGER NOT NULL DEFAULT 1,
    active_round_id TEXT,
    current_round_number INTEGER NOT NULL DEFAULT 1,
    parent_can_signal_revision_via_mcp INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    failure_detail TEXT,
    stopped_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(target_plan_id) REFERENCES plans(id) ON DELETE SET NULL
);

-- table: runtime_config_artifacts
CREATE TABLE runtime_config_artifacts (
  hash TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  source_ref TEXT,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- table: runtime_config_current
CREATE TABLE runtime_config_current (
  scope_key TEXT PRIMARY KEY,
  scope_provider TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  target_id TEXT,
  revision_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  source TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- table: runtime_config_session_context
CREATE TABLE runtime_config_session_context (
  session_id TEXT PRIMARY KEY,
  scope_provider TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  target_id TEXT,
  revision_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- table: seat_cooling
CREATE TABLE seat_cooling (
    seat_id TEXT PRIMARY KEY,
    harness_kind TEXT NOT NULL,
    cooling_until_epoch_s INTEGER NOT NULL,
    window TEXT,
    observed_at_epoch_s INTEGER NOT NULL
);

-- table: seat_rotation
CREATE TABLE seat_rotation (
    harness_kind TEXT PRIMARY KEY,
    last_served_seat_id TEXT NOT NULL,
    updated_at_epoch_s INTEGER NOT NULL
);

-- table: session_adapter_markers
CREATE TABLE session_adapter_markers (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    adapter_version TEXT,
    native_version TEXT,
    created_at TEXT NOT NULL
);

-- table: session_background_work
CREATE TABLE session_background_work (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    tracker_kind TEXT NOT NULL,
    source_agent_kind TEXT NOT NULL,
    agent_id TEXT,
    output_file TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    launched_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY (session_id, tool_call_id)
);

-- table: session_events
CREATE TABLE session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    turn_id TEXT,
    payload_json TEXT NOT NULL
, item_id TEXT, completion_wake_removal_key TEXT);

-- table: session_launch_intents
CREATE TABLE session_launch_intents (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    requested_model_id TEXT,
    requested_controls_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- table: session_link_completion_deliveries
CREATE TABLE session_link_completion_deliveries (
    delivery_id TEXT PRIMARY KEY,
    completion_id TEXT NOT NULL UNIQUE,
    session_link_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT NOT NULL,
    subagent_public_id TEXT,
    label TEXT,
    child_turn_id TEXT NOT NULL,
    child_last_event_seq INTEGER NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'cancelled')),
    assistant_text TEXT,
    notification_text TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'enqueued', 'delivered', 'abandoned', 'failed')),
    parent_prompt_seq INTEGER,
    parent_turn_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    lease_token TEXT,
    lease_expires_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    enqueued_at TEXT,
    delivered_at TEXT, retired_prompt_seq INTEGER, retired_prompt_id TEXT, removal_event_persisted_at TEXT,
    UNIQUE(child_session_id, child_turn_id)
);

-- table: session_link_completions
CREATE TABLE session_link_completions (
    completion_id TEXT PRIMARY KEY,
    session_link_id TEXT NOT NULL REFERENCES session_links(id) ON DELETE CASCADE,
    child_turn_id TEXT NOT NULL,
    child_last_event_seq INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    parent_event_seq INTEGER,
    parent_prompt_seq INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(session_link_id, child_turn_id)
);

-- table: session_link_wake_schedules
CREATE TABLE session_link_wake_schedules (
    session_link_id TEXT PRIMARY KEY REFERENCES session_links(id) ON DELETE CASCADE
);

-- table: session_links
CREATE TABLE session_links (
    id TEXT PRIMARY KEY,
    relation TEXT NOT NULL,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id),
    child_session_id TEXT NOT NULL REFERENCES sessions(id),
    workspace_relation TEXT NOT NULL,
    created_by_turn_id TEXT,
    created_by_tool_call_id TEXT,
    created_at TEXT NOT NULL, label TEXT, public_id TEXT, closed_at TEXT, subagent_closed_at TEXT,
    UNIQUE(relation, parent_session_id, child_session_id),
    CHECK(parent_session_id != child_session_id)
);

-- table: session_live_config_snapshots
CREATE TABLE session_live_config_snapshots (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id),
    source_seq INTEGER NOT NULL,
    raw_config_options_json TEXT NOT NULL,
    normalized_controls_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
, prompt_capabilities_json TEXT, full_snapshot_json TEXT);

-- table: session_pending_config_changes
CREATE TABLE session_pending_config_changes (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    config_id TEXT NOT NULL,
    value TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    PRIMARY KEY (session_id, config_id)
);

-- table: session_pending_prompts
CREATE TABLE session_pending_prompts (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq        INTEGER NOT NULL,
    prompt_id  TEXT,
    text       TEXT NOT NULL,
    queued_at  TEXT NOT NULL, blocks_json TEXT, provenance_json TEXT, queue_position INTEGER,
    PRIMARY KEY (session_id, seq)
);

-- table: session_prompt_attachments
CREATE TABLE session_prompt_attachments (
    attachment_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime_type TEXT,
    display_name TEXT,
    source_uri TEXT,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    content BLOB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
, source TEXT NOT NULL DEFAULT 'upload', storage_path TEXT NOT NULL DEFAULT '');

-- table: session_raw_notifications
CREATE TABLE session_raw_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    notification_kind TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

-- table: sessions
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    agent_kind TEXT NOT NULL,
    native_session_id TEXT,
    model_id TEXT,
    mode_id TEXT,
    thinking_level_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_prompt_at TEXT,
    closed_at TEXT
, thinking_budget_tokens INTEGER, title TEXT, requested_model_id TEXT, current_model_id TEXT, requested_mode_id TEXT, current_mode_id TEXT, dismissed_at TEXT, mcp_bindings_ciphertext TEXT, system_prompt_append TEXT, mcp_binding_summaries_json TEXT, origin_json TEXT, subagents_enabled INTEGER NOT NULL DEFAULT 1, mcp_binding_policy TEXT NOT NULL DEFAULT 'inherit_workspace', action_capabilities_json TEXT, agent_auth_contexts TEXT, pending_prompt_seq_cursor INTEGER NOT NULL DEFAULT 0, workflow_run_id TEXT, workflow_node_row_id TEXT);

-- table: terminal_command_runs
CREATE TABLE terminal_command_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    terminal_id TEXT,
    purpose TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    exit_code INTEGER,
    output_mode TEXT NOT NULL,
    stdout TEXT,
    stderr TEXT,
    combined_output TEXT,
    output_truncated INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- table: workflow_run_docs
CREATE TABLE workflow_run_docs (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    slug                  TEXT NOT NULL,
    filename              TEXT NOT NULL,             -- NN-slug.md; NN derived from the producing node's chain_index
    producing_node_row_id TEXT,
    seeded_from_template  INTEGER NOT NULL,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    UNIQUE (run_id, slug),
    -- The filename law is not injective over slugs alone (seeded "00-plan.md"
    -- from slug "plan" collides with a registered slug "00-plan"); two rows
    -- must never claim one file.
    UNIQUE (run_id, filename)
);

-- table: workflow_run_nodes
CREATE TABLE workflow_run_nodes (
    id                    TEXT PRIMARY KEY,          -- the node row id, the API-addressable identity
    run_id                TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    definition_node_id    TEXT,                      -- null for adhoc; replacements inherit it
    kind                  TEXT NOT NULL CHECK (kind IN ('defined','replacement','adhoc')),
    node_type             TEXT NOT NULL CHECK (node_type IN ('agent','human_in_loop')),  -- MUTABLE, type flips land here
    replaces_node_row_id  TEXT,
    anchor_node_row_id    TEXT,                      -- adhoc: where it hangs off the chain
    chain_index           INTEGER,                   -- position on the linear chain; adhoc copies its anchor's
    title                 TEXT NOT NULL,
    prompt                TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('pending','running','needs_attention','awaiting_human','completed','failed','cancelled')),
    session_id            TEXT,
    prompt_id             TEXT,                      -- the envelope prompt's id (provenance; the extension reports every turn end of a linked session)
    model                 TEXT,                      -- JSON NodeModel: the row's own launch pick (adhoc); NULL = resolve via the frozen definition, then the app default
    rendered_envelope     TEXT,                      -- JSON {instructionBlocks, firstMessage, systemPromptAppend}
    failure_code          TEXT CHECK (failure_code IS NULL OR failure_code IN ('node_launch_failed','turn_error','refusal','empty_turn','harness_cap','superseded')),
    first_turn_finished_at TEXT,                     -- first turn end of the CURRENT execution; bounds UndoAdvance
    created_at            TEXT NOT NULL,
    started_at            TEXT,
    completed_at          TEXT,
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

-- table: workflow_runs
CREATE TABLE workflow_runs (
    id                  TEXT PRIMARY KEY,            -- minted by the courier; PUT is idempotent on it
    invocation_id       TEXT NOT NULL,
    definition_json     TEXT NOT NULL,               -- verbatim snapshot, IMMUTABLE after insert
    arguments_json      TEXT NOT NULL,
    workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status              TEXT NOT NULL CHECK (status IN ('running','awaiting_human','interrupted','completed','failed','cancelled')),
    current_node_row_id TEXT,
    failure_code        TEXT CHECK (failure_code IS NULL OR failure_code IN ('node_launch_failed','turn_error','refusal','empty_turn','harness_cap','superseded')),
    interruption_code   TEXT CHECK (interruption_code IS NULL OR interruption_code IN ('user_cancel','app_shutdown','runtime_restarted')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    completed_at        TEXT,
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

-- table: workspace_access_modes
CREATE TABLE workspace_access_modes (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    handoff_op_id TEXT,
    updated_at TEXT NOT NULL
);

-- table: workspace_checkpoints
CREATE TABLE workspace_checkpoints (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('turn_start','fork_boundary','safety')),
    session_id TEXT,
    turn_id TEXT,
    prompt_id TEXT,
    fork_operation_id TEXT,
    revert_operation_id TEXT,
    head_sha TEXT NOT NULL,
    work_tree_oid TEXT NOT NULL,
    index_tree_oid TEXT NOT NULL,
    work_tree_anchored INTEGER NOT NULL,
    index_tree_anchored INTEGER NOT NULL,
    notices_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expired_at TEXT
);

-- table: workspace_setup_state
CREATE TABLE workspace_setup_state (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    latest_command_run_id TEXT NOT NULL REFERENCES terminal_command_runs(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL
);

-- table: workspaces
CREATE TABLE "workspaces" (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('local', 'worktree')),
            repo_root_id TEXT NOT NULL REFERENCES repo_roots(id),
            path TEXT NOT NULL,
            surface TEXT NOT NULL DEFAULT 'standard' CHECK (surface IN ('standard', 'cowork')),
            original_branch TEXT,
            current_branch TEXT,
            display_name TEXT,
            origin_json TEXT,
            creator_context_json TEXT,
            lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'archived')),
            archived_head_sha TEXT,
            archived_branch TEXT,
            archived_at TEXT,
            partial_capture_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

-- table: worktree_retention_policy
CREATE TABLE worktree_retention_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_materialized_worktrees_per_repo INTEGER NOT NULL
        CHECK (max_materialized_worktrees_per_repo BETWEEN 10 AND 100),
    updated_at TEXT NOT NULL
);

-- index: idx_agent_model_registry_snapshots_kind
CREATE INDEX idx_agent_model_registry_snapshots_kind
    ON agent_model_registry_snapshots(kind);

-- index: idx_agent_model_registry_snapshots_workspace
CREATE INDEX idx_agent_model_registry_snapshots_workspace
    ON agent_model_registry_snapshots(workspace_scope);

-- index: idx_completion_deliveries_due
CREATE INDEX idx_completion_deliveries_due
    ON session_link_completion_deliveries(state, next_attempt_at, lease_expires_at);

-- index: idx_completion_deliveries_parent_state
CREATE INDEX idx_completion_deliveries_parent_state
    ON session_link_completion_deliveries(parent_session_id, state);

-- index: idx_completion_deliveries_pending_removal
CREATE INDEX idx_completion_deliveries_pending_removal
    ON session_link_completion_deliveries(
        removal_event_persisted_at,
        next_attempt_at,
        lease_expires_at
    )
    WHERE retired_prompt_seq IS NOT NULL
      AND removal_event_persisted_at IS NULL;

-- index: idx_cowork_managed_workspaces_open_parent
CREATE INDEX idx_cowork_managed_workspaces_open_parent
    ON cowork_managed_workspaces(parent_session_id, closed_at);

-- index: idx_cowork_managed_workspaces_parent
CREATE INDEX idx_cowork_managed_workspaces_parent
    ON cowork_managed_workspaces(parent_session_id);

-- index: idx_cowork_managed_workspaces_public_id
CREATE UNIQUE INDEX idx_cowork_managed_workspaces_public_id
    ON cowork_managed_workspaces(public_id)
    WHERE public_id IS NOT NULL;

-- index: idx_cowork_managed_workspaces_source
CREATE INDEX idx_cowork_managed_workspaces_source
    ON cowork_managed_workspaces(source_workspace_id);

-- index: idx_cowork_threads_repo_root_id
CREATE INDEX idx_cowork_threads_repo_root_id ON cowork_threads(repo_root_id);

-- index: idx_cowork_threads_session_id
CREATE INDEX idx_cowork_threads_session_id ON cowork_threads(session_id);

-- index: idx_cowork_threads_workspace_id
CREATE INDEX idx_cowork_threads_workspace_id ON cowork_threads(workspace_id);

-- index: idx_feed_bindings_owner
CREATE UNIQUE INDEX idx_feed_bindings_owner
    ON feed_bindings(session_id, owner_kind, owner_id);

-- index: idx_fork_operations_child
CREATE INDEX idx_fork_operations_child ON fork_operations(child_session_id);

-- index: idx_fork_operations_parent
CREATE INDEX idx_fork_operations_parent ON fork_operations(parent_session_id);

-- index: idx_goals_session_created
CREATE INDEX idx_goals_session_created
    ON goals(session_id, created_at DESC);

-- index: idx_goals_single_open_per_session
CREATE UNIQUE INDEX idx_goals_single_open_per_session
    ON goals(session_id)
    WHERE status IN ('active', 'paused', 'blocked');

-- index: idx_loops_session_status
CREATE INDEX idx_loops_session_status
    ON loops(session_id, status);

-- index: idx_plan_handoffs_plan
CREATE INDEX idx_plan_handoffs_plan
    ON plan_handoffs(plan_id, created_at DESC);

-- index: idx_plan_interaction_links_request
CREATE UNIQUE INDEX idx_plan_interaction_links_request
    ON plan_interaction_links(session_id, request_id);

-- index: idx_plan_interaction_links_tool_call
CREATE INDEX idx_plan_interaction_links_tool_call
    ON plan_interaction_links(session_id, tool_call_id);

-- index: idx_plans_session_source
CREATE INDEX idx_plans_session_source
    ON plans(session_id, source_agent_kind, source_kind, updated_at DESC);

-- index: idx_plans_source_idempotency
CREATE UNIQUE INDEX idx_plans_source_idempotency
    ON plans(source_session_id, source_turn_id, source_item_id, source_kind)
    WHERE source_session_id IS NOT NULL
      AND source_turn_id IS NOT NULL
      AND source_item_id IS NOT NULL
      AND source_kind IS NOT NULL;

-- index: idx_plans_tool_call
CREATE INDEX idx_plans_tool_call
    ON plans(session_id, source_tool_call_id)
    WHERE source_tool_call_id IS NOT NULL;

-- index: idx_plans_workspace_updated
CREATE INDEX idx_plans_workspace_updated
    ON plans(workspace_id, updated_at DESC);

-- index: idx_review_assignments_reviewer_session
CREATE UNIQUE INDEX idx_review_assignments_reviewer_session
ON review_assignments(reviewer_session_id)
WHERE reviewer_session_id IS NOT NULL
  AND status IN ('launching', 'reviewing', 'reminded');

-- index: idx_review_assignments_round_status
CREATE INDEX idx_review_assignments_round_status
ON review_assignments(review_round_id, status);

-- index: idx_review_feedback_jobs_state
CREATE INDEX idx_review_feedback_jobs_state
ON review_feedback_jobs(state, next_attempt_at);

-- index: idx_review_rounds_run_status
CREATE INDEX idx_review_rounds_run_status
ON review_rounds(review_run_id, status);

-- index: idx_review_runs_parent_status
CREATE INDEX idx_review_runs_parent_status
ON review_runs(parent_session_id, status);

-- index: idx_session_background_work_pending
CREATE INDEX idx_session_background_work_pending
    ON session_background_work(session_id, state, launched_at);

-- index: idx_session_events_completion_wake_removal
CREATE UNIQUE INDEX idx_session_events_completion_wake_removal
    ON session_events(completion_wake_removal_key)
    WHERE completion_wake_removal_key IS NOT NULL;

-- index: idx_session_events_session_seq
CREATE UNIQUE INDEX idx_session_events_session_seq
    ON session_events(session_id, seq);

-- index: idx_session_link_completions_link
CREATE INDEX idx_session_link_completions_link
    ON session_link_completions(session_link_id);

-- index: idx_session_links_child
CREATE INDEX idx_session_links_child
    ON session_links(child_session_id);

-- index: idx_session_links_cowork_coding_child_owner
CREATE UNIQUE INDEX idx_session_links_cowork_coding_child_owner
    ON session_links(child_session_id)
    WHERE relation = 'cowork_coding_session';

-- index: idx_session_links_fork_child
CREATE UNIQUE INDEX idx_session_links_fork_child
    ON session_links (child_session_id)
    WHERE relation = 'fork';

-- index: idx_session_links_open_child_relation
CREATE INDEX idx_session_links_open_child_relation
    ON session_links(child_session_id, relation, closed_at);

-- index: idx_session_links_open_parent_relation
CREATE INDEX idx_session_links_open_parent_relation
    ON session_links(parent_session_id, relation, closed_at);

-- index: idx_session_links_parent
CREATE INDEX idx_session_links_parent
    ON session_links(parent_session_id);

-- index: idx_session_links_public_id
CREATE UNIQUE INDEX idx_session_links_public_id
    ON session_links(public_id)
    WHERE public_id IS NOT NULL;

-- index: idx_session_links_review_agent_child_owner
CREATE UNIQUE INDEX idx_session_links_review_agent_child_owner
ON session_links(relation, child_session_id)
WHERE relation = 'review_agent';

-- index: idx_session_links_subagent_child_owner
CREATE UNIQUE INDEX idx_session_links_subagent_child_owner
    ON session_links(relation, child_session_id)
    WHERE relation = 'subagent';

-- index: idx_session_pending_prompts_session_position
CREATE UNIQUE INDEX idx_session_pending_prompts_session_position
    ON session_pending_prompts (session_id, queue_position);

-- index: idx_session_pending_prompts_session_seq
CREATE INDEX idx_session_pending_prompts_session_seq
    ON session_pending_prompts (session_id, seq);

-- index: idx_session_prompt_attachments_session
CREATE INDEX idx_session_prompt_attachments_session
    ON session_prompt_attachments (session_id);

-- index: idx_session_prompt_attachments_state_updated
CREATE INDEX idx_session_prompt_attachments_state_updated
    ON session_prompt_attachments (state, updated_at);

-- index: idx_session_raw_notifications_session_seq
CREATE UNIQUE INDEX idx_session_raw_notifications_session_seq
    ON session_raw_notifications(session_id, seq);

-- index: idx_sessions_activity
CREATE INDEX idx_sessions_activity
    ON sessions(workspace_id, last_prompt_at, updated_at);

-- index: idx_sessions_workflow_run_id
CREATE INDEX idx_sessions_workflow_run_id ON sessions(workflow_run_id) WHERE workflow_run_id IS NOT NULL;

-- index: idx_terminal_command_runs_status
CREATE INDEX idx_terminal_command_runs_status
    ON terminal_command_runs(status);

-- index: idx_terminal_command_runs_terminal_created
CREATE INDEX idx_terminal_command_runs_terminal_created
    ON terminal_command_runs(terminal_id, created_at DESC);

-- index: idx_terminal_command_runs_workspace_activity
CREATE INDEX idx_terminal_command_runs_workspace_activity
    ON terminal_command_runs(workspace_id, completed_at, updated_at);

-- index: idx_terminal_command_runs_workspace_created
CREATE INDEX idx_terminal_command_runs_workspace_created
    ON terminal_command_runs(workspace_id, created_at DESC);

-- index: idx_workflow_run_docs_run_id
CREATE INDEX idx_workflow_run_docs_run_id ON workflow_run_docs(run_id);

-- index: idx_workflow_run_nodes_run_id
CREATE INDEX idx_workflow_run_nodes_run_id ON workflow_run_nodes(run_id);

-- index: idx_workflow_runs_workspace_id
CREATE INDEX idx_workflow_runs_workspace_id ON workflow_runs(workspace_id);

-- index: idx_workspace_checkpoints_session_turn
CREATE INDEX idx_workspace_checkpoints_session_turn ON workspace_checkpoints(session_id, turn_id);

-- index: idx_workspace_checkpoints_ws_created
CREATE INDEX idx_workspace_checkpoints_ws_created ON workspace_checkpoints(workspace_id, created_at);

-- index: idx_workspaces_lifecycle
CREATE INDEX idx_workspaces_lifecycle
            ON workspaces(repo_root_id, kind, lifecycle_state, surface);

-- index: idx_workspaces_path
CREATE INDEX idx_workspaces_path ON workspaces(path);

-- index: idx_workspaces_repo_root_id
CREATE INDEX idx_workspaces_repo_root_id ON workspaces(repo_root_id);
