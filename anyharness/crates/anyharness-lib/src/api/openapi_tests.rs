use serde_json::Value;

use super::openapi::openapi_json;

#[test]
fn openapi_registers_workspace_and_session_paths() {
    let spec: Value = serde_json::from_str(&openapi_json()).expect("parse OpenAPI JSON");
    let paths = spec["paths"]
        .as_object()
        .expect("OpenAPI paths should be an object");

    for path in [
        "/v1/workspaces/resolve",
        "/v1/workspaces",
        "/v1/workspaces/worktrees",
        "/v1/workspaces/{workspace_id}/worktree/restore",
        "/v1/workspaces/{workspace_id}/archive",
        "/v1/workspaces/{workspace_id}/unarchive",
        "/v1/workspaces/{workspace_id}",
        "/v1/workspaces/{workspace_id}/display-name",
        "/v1/workspaces/{workspace_id}/detect-setup",
        "/v1/workspaces/{workspace_id}/setup-status",
        "/v1/workspaces/{workspace_id}/setup-rerun",
        "/v1/workspaces/{workspace_id}/setup-start",
        "/v1/agents/{kind}/launch-options",
        "/v1/agents/{kind}/launch-options/refresh",
        "/v1/agents/{kind}/native-integrations",
        "/v1/agents/{kind}/native-integrations/{id}",
        "/v1/catalogs/agents/version",
        "/v1/sessions",
        "/v1/sessions/{session_id}",
        "/v1/sessions/{session_id}/title",
        "/v1/sessions/{session_id}/live-config",
        "/v1/sessions/{session_id}/config-options",
        "/v1/sessions/{session_id}/prompt",
        "/v1/sessions/{session_id}/fork",
        "/v1/sessions/{session_id}/pending-prompts/order",
        "/v1/sessions/{session_id}/pending-prompts/{seq}/steer",
        "/v1/sessions/{session_id}/resume",
        "/v1/sessions/{session_id}/cancel",
        "/v1/sessions/{session_id}/close",
        "/v1/sessions/{session_id}/dismiss",
        "/v1/workspaces/{workspace_id}/subagents",
        "/v1/sessions/{parent_session_id}/subagents",
        "/v1/sessions/{parent_session_id}/subagents/{child_session_id}/close",
        "/v1/sessions/{parent_session_id}/subagents/{child_session_id}/open",
        "/v1/sessions/{parent_session_id}/subagents/{child_session_id}/promote",
        "/v1/workspaces/{workspace_id}/sessions/restore",
        "/v1/sessions/{session_id}/events",
        "/v1/sessions/{session_id}/raw-notifications",
        "/v1/sessions/{session_id}/interactions/{request_id}/resolve",
        "/v1/sessions/{session_id}/interactions/{request_id}/mcp-url/reveal",
        "/v1/replay/recordings",
        "/v1/replay/sessions",
        "/v1/replay/sessions/{session_id}/advance",
        "/v1/repo-roots/{repo_root_id}/files/file",
        "/v1/repo-roots/{repo_root_id}/hosting/pull-requests",
        "/v1/worktrees/inventory",
        "/v1/worktrees/orphans/prune",
        "/v1/workspaces/{workspace_id}/terminals",
        "/v1/workspaces/{workspace_id}/git/diff/base-worktree-files",
        "/v1/terminals/{terminal_id}",
        "/v1/terminals/{terminal_id}/title",
        "/v1/terminals/{terminal_id}/resize",
        "/v1/terminals/{terminal_id}/commands",
        "/v1/terminal-command-runs/{command_run_id}",
    ] {
        assert!(paths.contains_key(path), "missing OpenAPI path: {path}");
    }

    // The binary is the only catalog transport (agent-distribution.md,
    // "Convergence"): the published contract must carry no document-push route.
    assert!(
        !paths.contains_key("/v1/catalogs/agents"),
        "the runtime must publish no catalog push route"
    );
    assert!(
        !paths.contains_key("/v1/sessions/{session_id}/subagents/{child_session_id}/wake"),
        "the public wake route must not remain in the contract"
    );
    for removed in [
        "/v1/agents/launch-options",
        "/v1/agents/{kind}/model-snapshot",
        "/v1/agents/{kind}/model-snapshot/refresh",
    ] {
        assert!(
            !paths.contains_key(removed),
            "removed launch-options compatibility path remains: {removed}"
        );
    }
}

#[test]
fn openapi_registers_workspace_session_and_event_schemas() {
    let spec: Value = serde_json::from_str(&openapi_json()).expect("parse OpenAPI JSON");
    let schemas = spec["components"]["schemas"]
        .as_object()
        .expect("OpenAPI schemas should be an object");

    for schema in [
        "OriginKind",
        "OriginEntrypoint",
        "OriginContext",
        "WorkspaceKind",
        "WorkspaceExecutionPhase",
        "WorkspaceExecutionSummary",
        "Workspace",
        "ResolveWorkspaceFromPathRequest",
        "CreateWorkspaceRequest",
        "WorktreeCheckoutMode",
        "WorktreeNameConflictPolicy",
        "CreateWorktreeWorkspaceRequest",
        "SetupScriptStatus",
        "SetupScriptExecution",
        "WorktreeBaseFetch",
        "CreateWorktreeWorkspaceResponse",
        "RestoreWorktreeWorkspaceOutcome",
        "RestoreWorktreeWorkspaceResponse",
        "SetupHintCategory",
        "SetupHint",
        "DetectProjectSetupResponse",
        "GetSetupStatusResponse",
        "StartWorkspaceSetupRequest",
        "UpdateWorkspaceDisplayNameRequest",
        "SessionStatus",
        "SessionExecutionPhase",
        "PendingInteractionSummary",
        "PendingInteractionSource",
        "PendingInteractionPayloadSummary",
        "SessionExecutionSummary",
        "Session",
        "SessionActionCapabilities",
        "SessionLinkSummary",
        "SessionMcpEnvVar",
        "SessionMcpHeader",
        "SessionMcpHttpServer",
        "SessionMcpStdioServer",
        "SessionMcpServer",
        "SessionMcpTransport",
        "SessionMcpBindingOutcome",
        "SessionMcpBindingNotAppliedReason",
        "SessionMcpBindingSummary",
        "AgentOperationsAgent",
        "AgentOperationsCapability",
        "AgentOperationsConfiguration",
        "AgentOperationsExecutionStatus",
        "AgentOperationsIdentity",
        "AgentOperationsPresentationStatus",
        "AgentOperationsRole",
        "AgentOperationsStatus",
        "AgentOperationsWorkspaceIdentity",
        "SubagentLatestCompletion",
        "SubagentLifecycleResponse",
        "SubagentParentRoster",
        "SubagentRelationship",
        "SubagentRosterEntry",
        "SubagentTurnOutcome",
        "SessionSubagentsResponse",
        "WorkspaceSubagentsResponse",
        "CreateSessionRequest",
        "ResumeSessionRequest",
        "UpdateSessionTitleRequest",
        "PromptInputBlock",
        "PromptSessionRequest",
        "PromptSessionResponse",
        "PromptSessionStatus",
        "ForkSessionRequest",
        "ForkSessionResponse",
        "PendingPromptSummary",
        "EditPendingPromptRequest",
        "ReorderPendingPromptsRequest",
        "InteractionDecision",
        "ResolveInteractionRequest",
        "RawSessionConfigValue",
        "SessionConfigOptionType",
        "RawSessionConfigOption",
        "NormalizedSessionControlValue",
        "NormalizedSessionControl",
        "NormalizedSessionControls",
        "SessionLiveConfigSnapshot",
        "GetSessionLiveConfigResponse",
        "SetSessionConfigOptionRequest",
        "ConfigApplyState",
        "SetSessionConfigOptionResponse",
        "ReplayRecordingSummary",
        "ListReplayRecordingsResponse",
        "ExportReplayRecordingRequest",
        "ExportReplayRecordingResponse",
        "CreateReplaySessionRequest",
        "CreateReplaySessionResponse",
        "AdvanceReplaySessionResponse",
        "SessionEventEnvelope",
        "SessionRawNotificationEnvelope",
        "SessionEvent",
        "SessionStartedEvent",
        "SessionEndedEvent",
        "SessionEndReason",
        "TurnStartedEvent",
        "TurnEndedEvent",
        "ItemStartedEvent",
        "ItemDeltaEvent",
        "ItemCompletedEvent",
        "TranscriptItemPayload",
        "TranscriptItemKind",
        "TranscriptItemStatus",
        "TranscriptItemDeltaPayload",
        "ContentPart",
        "ReasoningVisibility",
        "TerminalLifecycleEvent",
        "AgentLoginTerminalStatus",
        "AgentLoginTerminalRecord",
        "StartAgentLoginTerminalResponse",
        "TerminalPurpose",
        "TerminalStatus",
        "TerminalRecord",
        "CreateTerminalRequest",
        "ResizeTerminalRequest",
        "UpdateTerminalTitleRequest",
        "FileReadScope",
        "FileOpenTarget",
        "FileChangeOperation",
        "PlanEntry",
        "AvailableCommandsUpdatePayload",
        "CurrentModeUpdatePayload",
        "ConfigOptionUpdatePayload",
        "SessionStateUpdatePayload",
        "SessionInfoUpdatePayload",
        "SubagentTurnCompletedPayload",
        "ReviewRunUpdatedPayload",
        "SubagentTurnOutcome",
        "UsageUpdatePayload",
        "PendingPromptAddedPayload",
        "PendingPromptUpdatedPayload",
        "PendingPromptRemovedPayload",
        "PendingPromptsReorderedPayload",
        "PendingPromptRemovalReason",
        "InteractionRequestedEvent",
        "InteractionResolvedEvent",
        "InteractionKind",
        "InteractionSource",
        "InteractionPayload",
        "InteractionOutcome",
        "PermissionInteractionPayload",
        "PermissionInteractionOption",
        "PermissionInteractionOptionKind",
        "UserInputInteractionPayload",
        "UserInputQuestion",
        "UserInputQuestionOption",
        "McpElicitationInteractionPayload",
        "McpElicitationMode",
        "McpElicitationFormPayload",
        "McpElicitationUrlPayload",
        "McpElicitationField",
        "McpElicitationFieldBase",
        "McpElicitationTextField",
        "McpElicitationTextFormat",
        "McpElicitationNumberField",
        "McpElicitationBooleanField",
        "McpElicitationSelectField",
        "McpElicitationMultiSelectField",
        "McpElicitationOption",
        "McpElicitationSubmittedField",
        "McpElicitationSubmittedValue",
        "McpElicitationUrlRevealResponse",
        "ErrorEvent",
        "StopReason",
        "RuntimeCapabilities",
        "AgentSeedHealth",
        "AgentSeedStatus",
        "HarnessLaunchModel",
        "HarnessLaunchControlValue",
        "HarnessLaunchControl",
        "HarnessLaunchDefaults",
        "HarnessLaunchModelControls",
        "HarnessLaunchOptions",
        "HarnessLaunchOptionsState",
        "HarnessLaunchOptionsResponse",
        "WorkspaceFileKind",
        "ReadWorkspaceFileResponse",
        "PullRequestChecksState",
        "PullRequestReviewDecision",
        "BranchPullRequestSummary",
        "BranchPullRequestStatus",
        "RepoPullRequestStatusesResponse",
    ] {
        assert!(
            schemas.contains_key(schema),
            "missing OpenAPI schema: {schema}"
        );
    }

    let lifecycle = &schemas["SubagentLifecycleResponse"];
    assert!(lifecycle["required"]
        .as_array()
        .expect("lifecycle required fields")
        .iter()
        .any(|field| field == "relationship"));
    let relationship_union = lifecycle["properties"]["relationship"]["oneOf"]
        .as_array()
        .expect("relationship union");
    assert_eq!(relationship_union.len(), 2);
    assert!(relationship_union
        .iter()
        .any(|branch| branch["type"] == "null"));
    assert!(relationship_union
        .iter()
        .any(|branch| { branch["$ref"] == "#/components/schemas/SubagentRelationship" }));
    for removed in [
        "ScheduleSubagentWakeRequest",
        "ScheduleSubagentWakeResponse",
        "ParentSubagentLinkSummary",
        "ChildSubagentSummary",
        "SubagentCompletionSummary",
    ] {
        assert!(
            !schemas.contains_key(removed),
            "removed public wake/legacy roster schema remains: {removed}"
        );
    }
}

#[test]
fn destroy_source_documents_workflow_controlled_409() {
    // PR1227-MOBILITY-CONTRACT-01: the destroy-source handler fails closed with
    // 409 SESSION_CONTROLLED_BY_WORKFLOW exactly like the other fenced routes
    // (purge, mobility export), so its published contract MUST document
    // the 409 response. Pin it against the generated OpenAPI document.
    let spec: Value = serde_json::from_str(&openapi_json()).expect("parse OpenAPI JSON");
    let responses = &spec["paths"]["/v1/workspaces/{workspace_id}/mobility/destroy-source"]["post"]
        ["responses"];
    assert!(
        responses.get("409").is_some(),
        "destroy-source must document the 409 workflow-controlled contract response"
    );
    // The 409 must resolve to the shared ProblemDetails schema (body =
    // anyharness_contract::v1::ProblemDetails), so clients get the same
    // structured error shape as the other fenced routes rather than an
    // undocumented ad-hoc body.
    let schema_ref = responses["409"]["content"]["application/json"]["schema"]["$ref"]
        .as_str()
        .expect("destroy-source 409 must reference a JSON schema via $ref");
    assert_eq!(
        schema_ref, "#/components/schemas/ProblemDetails",
        "destroy-source 409 must reference the ProblemDetails schema"
    );
}

#[test]
fn pending_prompt_reorder_schema_requires_compare_and_swap_orders() {
    let spec: Value = serde_json::from_str(&openapi_json()).expect("parse OpenAPI JSON");
    let schema = &spec["components"]["schemas"]["ReorderPendingPromptsRequest"];
    let required = schema["required"]
        .as_array()
        .expect("reorder request required fields");
    assert!(required.iter().any(|value| value == "expectedSeqs"));
    assert!(required.iter().any(|value| value == "desiredSeqs"));
    assert!(schema["properties"].get("seqs").is_none());
}

#[test]
fn launch_option_schema_exposes_exact_models_controls_and_defaults() {
    let spec: Value = serde_json::from_str(&openapi_json()).expect("parse OpenAPI JSON");
    let schema = &spec["components"]["schemas"]["HarnessLaunchOptions"];
    assert!(schema["properties"].get("models").is_some());
    assert!(schema["properties"].get("controls").is_some());
    assert!(schema["properties"].get("defaults").is_some());
    assert!(schema["properties"].get("modelControls").is_some());

    let create = &spec["components"]["schemas"]["CreateSessionRequest"];
    assert!(
        create["properties"].get("controlValues").is_some(),
        "session create must expose the generic launch control map"
    );

    let handoff = &spec["components"]["schemas"]["HandoffPlanRequest"];
    assert_eq!(
        handoff["properties"]["controlValues"]["additionalProperties"]["type"], "string",
        "plan handoff must expose the generic launch control map"
    );

    for schema_name in [
        "NodeModel",
        "ReviewPersonaRequest",
        "ReviewAssignmentDetail",
    ] {
        assert_eq!(
            spec["components"]["schemas"][schema_name]["properties"]["controlValues"]
                ["additionalProperties"]["type"],
            "string",
            "{schema_name}.controlValues must remain an open string map"
        );
    }
}
