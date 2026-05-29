import type { AnyHarnessTimingCategory } from "@anyharness/sdk";
import type {
  MeasurementFinishReason as InfraMeasurementFinishReason,
  MeasurementOperationId as InfraMeasurementOperationId,
  MeasurementWorkflowOutcome as InfraMeasurementWorkflowOutcome,
} from "@/lib/infra/measurement/debug-measurement-catalog-types";
import type { MeasurementSummaryBudget } from "@/lib/infra/measurement/debug-measurement-registry-types";

export type MeasurementOperationId = InfraMeasurementOperationId;

export type MeasurementOperationKind =
  | "workspace_open"
  | "workspace_collections_refresh"
  | "workspace_hot_reopen"
  | "session_switch"
  | "session_hot_switch"
  | "session_history_initial_hydrate"
  | "session_history_tail_reconcile"
  | "session_history_older_chunk"
  | "session_stream_sample"
  | "session_stream_event_batch"
  | "prompt_submit"
  | "composer_typing"
  | "workspace_background_reconcile"
  | "transcript_scroll"
  | "file_tree_expand"
  | "file_tree_scroll"
  | "session_rename"
  | "workspace_rename"
  | "hover_sample"
  | "diff_review_sample";

export type MeasurementSurface =
  | "workspace-shell"
  | "workspace-sidebar-frame"
  | "workspace-sidebar"
  | "workspace-sidebar-primary-nav"
  | "workspace-sidebar-content"
  | "workspace-sidebar-footer"
  | "workspace-header-frame"
  | "workspace-content-frame"
  | "workspace-content-view"
  | "workspace-right-panel"
  | "workspace-command-palette"
  | "global-header"
  | "global-header-actions"
  | "header-tabs"
  | "header-tabs-strip"
  | "header-tabs-actions"
  | "chat-surface"
  | "chat-content"
  | "chat-composer"
  | "chat-composer-dock"
  | "chat-composer-dock-region"
  | "chat-composer-dock-slots"
  | "chat-composer-dock-input"
  | "chat-composer-dock-footer"
  | "session-transcript-pane"
  | "transcript-list"
  | "transcript-context-providers"
  | "transcript-row-list-router"
  | "transcript-virtualized-viewport"
  | "transcript-full-list"
  | "file-tree"
  | "chat-loading-hero"
  | "thinking-text"
  | "send-button"
  | "stop-button"
  | "header-tab"
  | "sidebar-workspace-row"
  | "changes-pane"
  | "diff-viewer";

export type MeasurementSampleKey =
  | "composer"
  | "transcript"
  | "file_tree"
  | "stream"
  | "send_button"
  | "stop_button"
  | "header_tab"
  | "sidebar_workspace_row"
  | "diff_review";

export type MeasurementFinishReason = InfraMeasurementFinishReason;

export type MeasurementCloudCategory =
  | "cloud.workspace.list"
  | "cloud.workspace.display_name.update";

export type MeasurementTimingCategory =
  | AnyHarnessTimingCategory
  | MeasurementCloudCategory;

export type MeasurementWorkflowStep =
  | "workspace.hot_reopen.activate"
  | "workspace.hot_reopen.after_paint"
  | "workspace.hot_reopen.reconcile"
  | "workspace.collections.fetch"
  | "workspace.collections.build"
  | "workspace.bootstrap.sessions"
  | "workspace.bootstrap.file_tree_init"
  | "workspace.bootstrap.dismissed_sessions"
  | "workspace.bootstrap.launch_catalog"
  | "workspace.bootstrap.initial_session"
  | "workspace.bootstrap.session_select"
  | "workspace.shell.pending_activation"
  | "workspace.shell.after_paint"
  | "workspace.shell.durable_intent"
  | "workspace.shell.real_activation"
  | "workspace.shell.pending_clear"
  | "workspace.shell.pending_rollback"
  | "session.select.hot_slot_activate"
  | "session.select.ensure_sessions"
  | "session.select.slot_store"
  | "session.select.history_hydrate"
  | "session.select.stream_connect"
  | "session.select.stream_connect_scheduled"
  | "session.history.fetch"
  | "session.history.replay"
  | "session.history.store"
  | "session.history.mount_subagents"
  | "session.history.resolve_target"
  | "session.summary.resolve_target"
  | "session.stream.initial_history_hydrate"
  | "session.stream.initial_refresh"
  | "session.stream.skip_cold_idle"
  | "session.stream.open_handle"
  | "session.stream.open"
  | "session.stream.resolve_target"
  | "session.resume.resolve_target"
  | "session.resume.workspace_get"
  | "session.resume.resolve_mcp"
  | "prompt.submit.blocks_prepare"
  | "prompt.submit.enqueue"
  | "prompt.submit.after_paint";

export type MeasurementStateCountTarget =
  | "session.history.events_fetched"
  | "session.history.events_before"
  | "session.history.events_after"
  | "session.history.turns_before"
  | "session.history.turns_after"
  | "session.history.items_before"
  | "session.history.items_after"
  | "session.stream.events_before"
  | "session.stream.events_after"
  | "session.stream.turns_before"
  | "session.stream.turns_after"
  | "session.stream.items_before"
  | "session.stream.items_after";

export type MeasurementWorkflowOutcome = InfraMeasurementWorkflowOutcome;

export const HOT_PAINT_MEASUREMENT_SUMMARY_BUDGET = {
  label: "hot_paint",
  requestCount: 0,
  firstCommitMs: 50,
  maxFrameGapMs: 50,
  maxCommitMs: 16,
  totalCommitMs: 80,
  surfaceCommitBudgets: {
    "workspace-shell": 2,
    "chat-surface": 2,
    "session-transcript-pane": 2,
    "transcript-list": 2,
    "header-tabs": 3,
    "workspace-sidebar": 3,
  },
} as const satisfies MeasurementSummaryBudget;

export const PROMPT_SUBMIT_MEASUREMENT_SURFACES = [
  "chat-composer",
  "chat-composer-dock",
  "chat-composer-dock-region",
  "chat-composer-dock-slots",
  "chat-composer-dock-input",
  "chat-composer-dock-footer",
  "chat-surface",
  "session-transcript-pane",
  "transcript-list",
  "transcript-context-providers",
  "transcript-row-list-router",
  "transcript-virtualized-viewport",
  "transcript-full-list",
  "header-tabs",
] as const satisfies readonly MeasurementSurface[];

export const PROMPT_SUBMIT_MEASUREMENT_MAX_DURATION_MS = 5_000;
