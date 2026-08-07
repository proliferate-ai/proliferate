//! The settings-read / launch-path agreement law.
//!
//! agent-distribution.md, "Readiness projection": *"The settings read surface and
//! the launch path resolve readiness the same way (route-aware); the UI never
//! shows `CredentialsRequired` for a harness that would launch fine."*
//!
//! Before this, `GET /v1/agents` resolved native-only while session launch
//! resolved route-aware, so a gateway-enrolled harness with no native login read
//! `CredentialsRequired` in settings and then launched successfully — the
//! projection lied on the exact surface a user reads to decide whether to
//! authenticate. These tests pin the agreement itself (the two surfaces agree on
//! the same inputs), not just each surface's local behavior, because agreement is
//! the property that regressed.
//!
//! Split from `service_tests.rs` for the repo line-count ceiling; nested inside
//! it so its temp-dir/env guards are in scope.

use super::*;
use crate::domains::agents::registry::built_in_registry;
use crate::integrations::agent_cli::executable::make_executable;

/// A grok runtime home whose ACP process is present via override but which has
/// no credential anywhere: grok has no native artifact, so this resolves to a
/// pure CREDENTIAL gap rather than `InstallRequired`, which is the arm a route is
/// allowed to clear.
///
/// Holds the module env lock for its own lifetime, because the override program,
/// `HOME`, and the credential vars it manipulates are process-global — see
/// `lock_env` in the parent module.
struct CredentialGapWorld {
    runtime_home: PathBuf,
    empty_home: PathBuf,
    _env: std::sync::MutexGuard<'static, ()>,
    _program: EnvVarGuard,
    _home: EnvVarGuard,
    _xai: EnvVarGuard,
    _grok: EnvVarGuard,
}

impl CredentialGapWorld {
    fn new(prefix: &str) -> Self {
        let env = lock_env();
        let runtime_home = make_temp_dir(prefix);
        let bin = runtime_home.join("grok-acp");
        std::fs::write(&bin, "#!/bin/sh\nexit 0\n").expect("write override binary");
        make_executable(&bin).expect("make override binary executable");
        let empty_home = make_temp_dir(&format!("{prefix}-home"));
        Self {
            _env: env,
            _program: EnvVarGuard::set("ANYHARNESS_GROK_AGENT_PROGRAM", &bin),
            _home: EnvVarGuard::set("HOME", &empty_home),
            _xai: EnvVarGuard::remove("XAI_API_KEY"),
            _grok: EnvVarGuard::remove("GROK_API_KEY"),
            runtime_home,
            empty_home,
        }
    }

    fn enroll_gateway_route(&self) {
        let state_dir = self.runtime_home.join("agent-auth");
        std::fs::create_dir_all(&state_dir).expect("create agent-auth dir");
        std::fs::write(
            state_dir.join("state.json"),
            r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"grok","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
        )
        .expect("write state");
    }
}

impl Drop for CredentialGapWorld {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.runtime_home);
        let _ = std::fs::remove_dir_all(&self.empty_home);
    }
}

fn grok_descriptor() -> AgentDescriptor {
    built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Grok)
        .expect("missing Grok descriptor")
}

/// The law, stated as an agreement: on identical inputs, the settings read
/// (`resolve_agent`, which `GET /v1/agents` and `GET /v1/agents/{kind}` call) and
/// the launch path (`resolve_launch_agent`) must return the same status and the
/// same credential state — both before and after a route is enrolled.
#[test]
fn the_settings_read_and_the_launch_path_agree_before_and_after_enrollment() {
    let world = CredentialGapWorld::new("readiness-route-agreement");
    let grok = grok_descriptor();

    let settings_before = resolve_agent(&grok, &world.runtime_home);
    let launch_before = resolve_launch_agent(&grok, &world.runtime_home, &BTreeMap::new());
    assert!(
        matches!(
            settings_before.status,
            ResolvedAgentStatus::LoginRequired | ResolvedAgentStatus::CredentialsRequired
        ),
        "precondition: an unrouted, credential-less grok is a credential gap, got {:?}",
        settings_before.status
    );
    assert_eq!(settings_before.status, launch_before.status);
    assert_eq!(
        settings_before.credential_state,
        launch_before.credential_state
    );

    world.enroll_gateway_route();

    let settings_after = resolve_agent(&grok, &world.runtime_home);
    let launch_after = resolve_launch_agent(&grok, &world.runtime_home, &BTreeMap::new());
    assert_eq!(
        settings_after.status,
        ResolvedAgentStatus::Ready,
        "settings must not report a credential gap for a harness that launches fine"
    );
    assert_eq!(settings_after.status, launch_after.status);
    assert_eq!(
        settings_after.credential_state,
        launch_after.credential_state
    );
    assert_eq!(
        settings_after.credential_state,
        CredentialState::ReadyViaLocalAuth
    );
}

/// Route-upgraded-ready and natively-ready collapse to the same
/// `credential_state`, so the projection must carry the PROVENANCE separately or
/// a client that means "the vendor CLI is logged in here" (first-run native-auth
/// adoption, CLI login chrome) silently reads a gateway route as a native login.
/// `credentials_from_route` is that provenance, and it must be set ONLY by the
/// route upgrade.
#[test]
fn route_upgraded_readiness_is_distinguishable_from_native_readiness() {
    let world = CredentialGapWorld::new("readiness-route-provenance");
    let grok = grok_descriptor();

    // Unrouted credential gap: not ready, and certainly not "from route".
    let before = resolve_agent(&grok, &world.runtime_home);
    assert!(!before.credentials_from_route);

    world.enroll_gateway_route();

    let routed = resolve_agent(&grok, &world.runtime_home);
    assert_eq!(routed.status, ResolvedAgentStatus::Ready);
    assert!(
        routed.credentials_from_route,
        "a route-upgraded Ready must be flagged as route-sourced"
    );
    // Launch resolution agrees (same upgrade path), and the unrouted projection
    // never claims a route.
    assert!(
        resolve_launch_agent(&grok, &world.runtime_home, &BTreeMap::new())
            .credentials_from_route
    );
    assert!(!resolve_agent_unrouted(&grok, &world.runtime_home).credentials_from_route);
}

/// The flag means "the ROUTE is why this is ready", so an agent that is ready on
/// its own credential must not carry it even when a route is also enrolled — the
/// upgrade is a no-op there, and a client would otherwise be told a real native
/// login is a gateway one.
#[test]
fn a_natively_ready_agent_is_never_flagged_as_route_sourced() {
    let world = CredentialGapWorld::new("readiness-route-provenance-native");
    let grok = grok_descriptor();
    world.enroll_gateway_route();
    const CREDENTIAL_VAR: &str = "XAI_API_KEY";

    let mut composed = BTreeMap::new();
    composed.insert(CREDENTIAL_VAR.to_string(), "workspace-key".to_string());
    let resolved = resolve_launch_agent(&grok, &world.runtime_home, &composed);

    assert_eq!(resolved.status, ResolvedAgentStatus::Ready);
    assert!(
        !resolved.credentials_from_route,
        "readiness earned by the agent's own credential is not route-sourced"
    );
}

/// A route that cannot lift the verdict (a missing binary) must not claim credit
/// for it either — the flag tracks an actual upgrade, not the mere presence of a
/// route.
#[test]
fn a_route_that_cannot_upgrade_does_not_claim_provenance() {
    let _env = lock_env();
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");
    let runtime_home = make_temp_dir("readiness-route-provenance-install");
    let state_dir = runtime_home.join("agent-auth");
    std::fs::create_dir_all(&state_dir).expect("create agent-auth dir");
    std::fs::write(
        state_dir.join("state.json"),
        r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"claude","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    )
    .expect("write state");

    let resolved = resolve_agent(&claude, &runtime_home);
    assert_eq!(resolved.status, ResolvedAgentStatus::InstallRequired);
    assert!(!resolved.credentials_from_route);

    let _ = std::fs::remove_dir_all(runtime_home);
}

/// A route enrolled for a DIFFERENT harness must not upgrade this one: the
/// settings read resolves the route per harness, exactly as launch does.
#[test]
fn the_settings_read_only_honors_this_harnesss_route() {
    let world = CredentialGapWorld::new("readiness-route-other-harness");
    let grok = grok_descriptor();
    let state_dir = world.runtime_home.join("agent-auth");
    std::fs::create_dir_all(&state_dir).expect("create agent-auth dir");
    std::fs::write(
        state_dir.join("state.json"),
        r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"claude","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    )
    .expect("write state");

    let settings = resolve_agent(&grok, &world.runtime_home);
    assert!(
        matches!(
            settings.status,
            ResolvedAgentStatus::LoginRequired | ResolvedAgentStatus::CredentialsRequired
        ),
        "claude's route must not upgrade grok, got {:?}",
        settings.status
    );
    assert_eq!(
        settings.status,
        resolve_launch_agent(&grok, &world.runtime_home, &BTreeMap::new()).status
    );
}

/// Route-awareness on the read surface must not become a way to mask a missing
/// binary: the same "a route supplies credentials, not binaries" fence that
/// guards launch guards the read.
#[test]
fn the_settings_read_never_masks_a_missing_binary() {
    // Reads HOME (claude's local-auth discovery) — serialize with the guards.
    let _env = lock_env();
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");
    let runtime_home = make_temp_dir("readiness-route-missing-binary");
    let state_dir = runtime_home.join("agent-auth");
    std::fs::create_dir_all(&state_dir).expect("create agent-auth dir");
    std::fs::write(
        state_dir.join("state.json"),
        r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"claude","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    )
    .expect("write state");

    let settings = resolve_agent(&claude, &runtime_home);
    assert_eq!(
        settings.status,
        ResolvedAgentStatus::InstallRequired,
        "a route must not mask a missing agent binary on the read surface either"
    );

    let _ = std::fs::remove_dir_all(runtime_home);
}

/// The login flow deliberately reads the UNROUTED projection: an enrolled
/// gateway route says nothing about where the vendor CLI lives, and the user must
/// still be able to run a native login while routed. `resolve_agent_unrouted`
/// therefore ignores the state file that `resolve_agent` honors.
#[test]
fn the_unrouted_projection_ignores_an_enrolled_route() {
    let world = CredentialGapWorld::new("readiness-route-unrouted");
    let grok = grok_descriptor();
    world.enroll_gateway_route();

    let routed = resolve_agent(&grok, &world.runtime_home);
    let unrouted = resolve_agent_unrouted(&grok, &world.runtime_home);

    assert_eq!(routed.status, ResolvedAgentStatus::Ready);
    assert!(
        matches!(
            unrouted.status,
            ResolvedAgentStatus::LoginRequired | ResolvedAgentStatus::CredentialsRequired
        ),
        "the unrouted read answers 'is the vendor CLI logged in', got {:?}",
        unrouted.status
    );
    assert_ne!(routed.credential_state, unrouted.credential_state);
}

/// The env-scope split, at the readiness layer: a host-exported credential must
/// not make a WORKSPACE-scoped resolve read `Ready` (agent-distribution.md's
/// ambient law), while the host-scoped settings read is allowed to see it.
#[test]
fn workspace_scoped_resolution_ignores_a_host_exported_credential() {
    let world = CredentialGapWorld::new("readiness-scope-split");
    let grok = grok_descriptor();
    // Assert the var this test hardcodes is really one grok declares, so a
    // registry rename breaks the test instead of silently making it vacuous.
    const CREDENTIAL_VAR: &str = "XAI_API_KEY";
    assert!(
        grok.auth
            .slots
            .iter()
            .any(|slot| slot.env_vars.iter().any(|var| var == CREDENTIAL_VAR)),
        "grok must declare {CREDENTIAL_VAR}"
    );

    // Exported on the host, absent from the workspace's composed env. This
    // shadows CredentialGapWorld's remove-guard for the rest of the test.
    let _exported = EnvVarGuard::set_str(CREDENTIAL_VAR, "host-global-key");

    let workspace = resolve_agent_with_env(&grok, &world.runtime_home, &BTreeMap::new());
    assert!(
        matches!(
            workspace.status,
            ResolvedAgentStatus::LoginRequired | ResolvedAgentStatus::CredentialsRequired
        ),
        "a host export must not authenticate a workspace, got {:?}",
        workspace.status
    );

    // The same variable IN the workspace's composed env does authenticate it.
    let mut composed = BTreeMap::new();
    composed.insert(CREDENTIAL_VAR.to_string(), "workspace-key".to_string());
    let with_workspace_credential = resolve_agent_with_env(&grok, &world.runtime_home, &composed);
    assert_eq!(
        with_workspace_credential.status,
        ResolvedAgentStatus::Ready,
        "the workspace's own credential must count"
    );

    // And the host-scoped read (no workspace in view) legitimately sees the
    // host's export — that scope has no workspace to over-authenticate.
    assert_eq!(
        resolve_agent_unrouted(&grok, &world.runtime_home).status,
        ResolvedAgentStatus::Ready
    );
}

/// The not-in-registry arm behind [`resolve_agent_unrouted_by_kind`] (shared
/// by `AcpProbeRunner::run`, the `catalog-probe` CLI, and the
/// probe-materialization test — see that fn's doc comment). The bundled
/// registry always carries every `AgentKind` variant, so this exercises
/// [`find_descriptor_by_kind`] directly against a hand-built registry slice
/// with one kind removed — the only way to make the arm reachable at all.
#[test]
fn find_descriptor_by_kind_reports_a_kind_missing_from_the_registry() {
    let registry_missing_grok: Vec<AgentDescriptor> = built_in_registry()
        .into_iter()
        .filter(|descriptor| descriptor.kind != AgentKind::Grok)
        .collect();

    let error = find_descriptor_by_kind(&registry_missing_grok, &AgentKind::Grok)
        .expect_err("grok was filtered out of this registry slice");
    assert_eq!(error.to_string(), "agent kind grok not in registry");

    // The kinds still present resolve normally — the filter did not break the
    // happy path.
    assert!(find_descriptor_by_kind(&registry_missing_grok, &AgentKind::Claude).is_ok());
}
