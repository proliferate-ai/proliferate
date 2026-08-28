use std::path::{Path, PathBuf};

use crate::app::{test_support, AppState};
use crate::domains::mobility::model::{
    WorkspaceMobilityArchiveData, WorkspaceMobilityExportOptions,
};
use crate::domains::sessions::links::completions::{LinkCompletionStore, LinkWakeScheduleRecord};
use crate::domains::sessions::links::model::{SessionLinkRelation, SessionLinkWorkspaceRelation};
use crate::domains::sessions::links::service::{CreateSessionLinkInput, SessionLinkService};
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, temp_runtime_home,
};
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;

const SOURCE_WORKSPACE_ID: &str = "workspace-b";
const DESTINATION_WORKSPACE_ID: &str = "mobility-wake-destination";
const INVALID_DESTINATION_WORKSPACE_ID: &str = "mobility-wake-invalid-destination";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cowork_wake_schedule_survives_preflight_export_and_install_while_subagent_is_denied() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let source_home = temp_runtime_home("cowork-wake-mobility");
    let source_repo = source_home.join(SOURCE_WORKSPACE_ID);
    initialize_git_repo(&source_repo);
    let source = build_state(
        &source_home,
        Db::open(&source_home).expect("file-backed source db"),
        true,
    );
    let (cowork_link_id, subagent_link_id) = seed_link_schedules(&source);

    let preflight = source
        .mobility_runtime
        .preflight_workspace(SOURCE_WORKSPACE_ID, &[])
        .await
        .expect("Cowork-linked graph preflight");
    assert!(preflight.can_move, "blockers: {:?}", preflight.blockers);
    assert!(preflight.archive_estimated_bytes.is_some());

    let archive = source
        .mobility_runtime
        .export_workspace_archive(
            SOURCE_WORKSPACE_ID,
            &WorkspaceMobilityExportOptions::default(),
        )
        .expect("export Cowork wake archive");
    assert_eq!(
        archive
            .session_link_wake_schedules
            .iter()
            .map(|schedule| schedule.session_link_id.as_str())
            .collect::<Vec<_>>(),
        [cowork_link_id.as_str()],
        "export keeps Cowork wake schedules and drops stale Subagent schedules"
    );

    let destination_home = temp_runtime_home("cowork-wake-mobility-destination");
    let destination_repo = clone_repo(&source_repo, &destination_home, "workspace-destination");
    let destination = destination_state(
        &destination_home,
        &destination_repo,
        DESTINATION_WORKSPACE_ID,
    );
    install_archive(&destination, DESTINATION_WORKSPACE_ID, &archive)
        .await
        .expect("install Cowork wake archive");
    let installed_schedules = LinkCompletionStore::new(destination.db.clone())
        .list_wake_schedules(&[cowork_link_id.clone(), subagent_link_id.clone()])
        .expect("installed wake schedules");
    assert_eq!(
        installed_schedules,
        [LinkWakeScheduleRecord {
            session_link_id: cowork_link_id.clone(),
        }]
    );

    let mut invalid_archive = archive.clone();
    invalid_archive
        .session_link_wake_schedules
        .push(LinkWakeScheduleRecord {
            session_link_id: subagent_link_id,
        });
    let invalid_home = temp_runtime_home("subagent-wake-mobility-destination");
    let invalid_repo = clone_repo(&source_repo, &invalid_home, "workspace-invalid");
    let invalid_destination = destination_state(
        &invalid_home,
        &invalid_repo,
        INVALID_DESTINATION_WORKSPACE_ID,
    );
    let error = install_archive(
        &invalid_destination,
        INVALID_DESTINATION_WORKSPACE_ID,
        &invalid_archive,
    )
    .await
    .expect_err("Subagent-linked wake schedule must be rejected");
    assert!(error
        .to_string()
        .contains("archive wake schedule references non-Cowork session link"));

    drop(invalid_destination);
    drop(destination);
    drop(source);
    std::fs::remove_dir_all(invalid_home).expect("remove invalid destination home");
    std::fs::remove_dir_all(destination_home).expect("remove destination home");
    std::fs::remove_dir_all(source_home).expect("remove source home");
}

fn seed_link_schedules(source: &AppState) -> (String, String) {
    let sessions = SessionStore::new(source.db.clone());
    let parent = sessions
        .find_by_id("target")
        .expect("load source parent")
        .expect("source parent");
    for (id, title) in [
        ("cowork-child", "Cowork child"),
        ("subagent-child", "Subagent child"),
    ] {
        let mut child = parent.clone();
        child.id = id.to_string();
        child.title = Some(title.to_string());
        child.native_session_id = None;
        child.last_prompt_at = None;
        sessions.insert(&child).expect("insert linked child");
    }
    let links = SessionLinkService::new(SessionLinkStore::new(source.db.clone()), sessions.clone());
    let cowork = links
        .create_link(link_input(
            SessionLinkRelation::CoworkCodingSession,
            "cowork-child",
        ))
        .expect("create Cowork link");
    let subagent = links
        .create_link(link_input(SessionLinkRelation::Subagent, "subagent-child"))
        .expect("create Subagent link");
    let completions = LinkCompletionStore::new(source.db.clone());
    assert!(completions
        .schedule_wake(&cowork.id)
        .expect("schedule Cowork wake"));
    assert!(completions
        .schedule_wake(&subagent.id)
        .expect("seed stale Subagent wake"));
    (cowork.id, subagent.id)
}

fn link_input(relation: SessionLinkRelation, child_session_id: &str) -> CreateSessionLinkInput {
    CreateSessionLinkInput {
        relation,
        parent_session_id: "target".to_string(),
        child_session_id: child_session_id.to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: None,
        created_by_turn_id: None,
        created_by_tool_call_id: None,
    }
}

fn initialize_git_repo(path: &Path) {
    std::fs::create_dir_all(path).expect("create source git repository");
    super::super::run_git(path, &["init", "-b", "main"]);
    std::fs::write(path.join("README.md"), "Cowork wake mobility fixture\n")
        .expect("write source fixture");
    super::super::run_git(path, &["add", "README.md"]);
    super::super::run_git(
        path,
        &[
            "-c",
            "user.name=AnyHarness Test",
            "-c",
            "user.email=anyharness@example.test",
            "commit",
            "-m",
            "seed Cowork wake mobility fixture",
        ],
    );
    super::super::run_git(path, &["checkout", "-b", "feature/cowork-wake-mobility"]);
}

fn clone_repo(source: &Path, home: &Path, name: &str) -> PathBuf {
    std::fs::create_dir_all(home).expect("create destination runtime home");
    let destination = home.join(name);
    super::super::run_git(
        home,
        &[
            "clone",
            source.to_string_lossy().as_ref(),
            destination.to_string_lossy().as_ref(),
        ],
    );
    destination
}

fn destination_state(runtime_home: &Path, repo: &Path, workspace_id: &str) -> AppState {
    let state = build_state(
        runtime_home,
        Db::open(runtime_home).expect("file-backed destination db"),
        false,
    );
    test_support::seed_workspace_with_repo_root(
        &state.db,
        workspace_id,
        "local",
        &repo.to_string_lossy(),
    );
    state
}

async fn install_archive(
    destination: &AppState,
    workspace_id: &str,
    archive: &WorkspaceMobilityArchiveData,
) -> Result<
    crate::domains::mobility::model::ImportedWorkspaceArchiveSummary,
    crate::domains::mobility::service::MobilityError,
> {
    let runtime = destination.mobility_runtime.clone();
    let workspace_id = workspace_id.to_string();
    let archive = archive.clone();
    tokio::task::spawn_blocking(move || {
        runtime.install_workspace_archive(&workspace_id, &archive, None)
    })
    .await
    .expect("join mobility install")
}
