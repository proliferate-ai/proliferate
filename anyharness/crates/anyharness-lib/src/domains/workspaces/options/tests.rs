use super::*;

fn options(availability: WorkspaceRepositoryAvailability) -> WorkspaceCreationOptions {
    WorkspaceCreationOptions {
        repositories: vec![WorkspaceRepositoryOption {
            repository_id: "repo-1".into(),
            name: "Repo".into(),
            path: "/repo".into(),
            default_branch: Some("main".into()),
            current_branch: Some("main".into()),
            branches: Vec::new(),
            executable: availability.is_present(),
            unavailable_reason: availability.public_reason(),
            availability,
        }],
        creation_modes: Vec::new(),
    }
}

fn input(mode: &str, branch: Option<&str>) -> CreateWorkspaceFromOptionsInput {
    CreateWorkspaceFromOptionsInput {
        repository_id: "repo-1".into(),
        creation_mode: mode.into(),
        branch: branch.map(str::to_string),
        display_name: None,
        origin: OriginContext::system_local_runtime(),
        creator_context: WorkspaceCreatorContext::Agent {
            source_session_id: "session-1".into(),
            source_session_workspace_id: Some("workspace-1".into()),
            session_link_id: None,
            source_workspace_id: Some("workspace-1".into()),
            label: None,
        },
    }
}

#[test]
fn shared_validator_accepts_the_listed_modes_and_enforces_branch_shape() {
    let available = options(WorkspaceRepositoryAvailability::Present);
    let worktree =
        validate_workspace_creation(&available, &input("worktree", Some("feature/agent-ops")))
            .expect("listed worktree choice");
    assert_eq!(worktree.creation_mode, WorkspaceCreationMode::Worktree);
    assert_eq!(worktree.branch.as_deref(), Some("feature/agent-ops"));

    assert!(matches!(
        validate_workspace_creation(&available, &input("worktree", None)),
        Err(WorkspaceOptionsError::BranchRequired)
    ));
    assert!(matches!(
        validate_workspace_creation(&available, &input("local", Some("main"))),
        Err(WorkspaceOptionsError::BranchNotAllowed)
    ));
    assert!(validate_workspace_creation(&available, &input("local", None)).is_ok());
}

#[test]
fn stale_missing_and_unreadable_repositories_are_typed_rejections() {
    for availability in [
        WorkspaceRepositoryAvailability::Missing,
        WorkspaceRepositoryAvailability::Unreadable {
            diagnostic: "permission denied at /private/runtime/repository".into(),
        },
    ] {
        let error =
            validate_workspace_creation(&options(availability.clone()), &input("local", None))
                .expect_err("unavailable option must be rejected");
        assert!(matches!(
            error,
            WorkspaceOptionsError::RepositoryUnavailable {
                availability: observed,
                ..
            } if observed == availability
        ));
    }
}

#[test]
fn unreadable_repository_serializes_only_a_stable_state_and_safe_message() {
    let raw_diagnostic =
        "fatal: could not read /private/customer/repository/.git: permission denied";
    let availability = WorkspaceRepositoryAvailability::Unreadable {
        diagnostic: raw_diagnostic.to_string(),
    };
    let projected = options(availability.clone());
    let json = serde_json::to_value(&projected).expect("serialize workspace options");
    assert_eq!(
        json["repositories"][0]["availability"]["state"],
        "unreadable"
    );
    assert_eq!(
        json["repositories"][0]["unavailableReason"],
        "The repository checkout could not be read."
    );
    let serialized = json.to_string();
    assert!(!serialized.contains(raw_diagnostic));
    assert!(!serialized.contains("/private/customer"));

    let error = WorkspaceOptionsError::RepositoryUnavailable {
        repository_id: "repo-1".to_string(),
        availability,
    };
    assert_eq!(error.code(), "WORKSPACE_REPOSITORY_UNAVAILABLE");
    let public = error.public_message();
    assert_eq!(public, "The repository checkout could not be read.");
    assert!(!public.contains("permission denied"));
    assert!(!public.contains("/private/customer"));
}

#[test]
fn existing_branch_metadata_is_explicitly_not_a_creation_token() {
    let metadata = WorkspaceBranchMetadata::from(GitBranch {
        name: "main".into(),
        is_remote: false,
        is_head: true,
        is_default: true,
        upstream: Some("origin/main".into()),
    });
    assert!(!metadata.selectable_for_creation);
}
