use std::{collections::BTreeMap, sync::Arc};

use sentry::protocol::{Breadcrumb, Context as SentryContext, User, Value};

use super::{
    default_release, log_path_for_command, runtime_home_from_install, runtime_home_from_serve,
    scrub, sentry_event_filter_for_target, sentry_event_mapper, sentry_scope_tags,
    sentry_user_from_id, stamped_git_sha, RUNTIME_INCIDENT_FINGERPRINT,
};
use crate::{
    cli::Commands,
    commands::{install_agents::InstallAgentsArgs, serve::ServeArgs},
};
use anyharness_lib::observability::{AGENT_STDERR_TRACING_TARGET, RUNTIME_INCIDENT_TRACING_TARGET};

fn sentry_test_options() -> sentry::ClientOptions {
    sentry::ClientOptions {
        release: Some("anyharness@test".into()),
        environment: Some("test".into()),
        traces_sample_rate: 1.0,
        send_default_pii: false,
        before_send: Some(Arc::new(scrub::event)),
        before_breadcrumb: Some(Arc::new(scrub::breadcrumb)),
        before_send_log: Some(Arc::new(scrub::log)),
        ..Default::default()
    }
}

fn string_field<'a>(fields: &'a BTreeMap<String, Value>, key: &str) -> &'a str {
    match fields.get(key) {
        Some(Value::String(value)) => value,
        other => panic!("expected string field {key}, got {other:?}"),
    }
}

#[test]
fn tracing_error_reaches_the_sentry_client() {
    // Regression (B2 amendment): PR #684 bumped `sentry` to 0.48 while
    // `sentry-tracing` stayed at 0.47, linking two `sentry-core` instances.
    // The tracing layer then captured events into the 0.47 Hub — which has
    // no client — so every runtime ERROR event was silently dropped in
    // production from 2026-06-14. This test binds a test client to the same
    // `sentry-core` the layer uses; it fails (0 events) whenever the two
    // crates diverge again.
    use tracing_subscriber::layer::SubscriberExt;
    let subscriber = tracing_subscriber::registry()
        .with(sentry_tracing::layer().event_mapper(sentry_event_mapper));
    let events = sentry::test::with_captured_events_options(
        || {
            tracing::subscriber::with_default(subscriber, || {
                tracing::error!("sentry emission regression probe");
            });
        },
        sentry_test_options(),
    );
    assert_eq!(
        events.len(),
        1,
        "tracing ERROR must reach the Sentry client"
    );
    assert_eq!(events[0].level, sentry::Level::Error);
    assert!(events[0]
        .fingerprint
        .iter()
        .all(|part| part.as_ref() != RUNTIME_INCIDENT_FINGERPRINT));
}

#[test]
fn agent_stderr_stays_out_of_sentry_while_runtime_errors_remain_visible() {
    use tracing_subscriber::layer::SubscriberExt;
    let subscriber = tracing_subscriber::registry()
        .with(sentry_tracing::layer().event_mapper(sentry_event_mapper));
    let events = sentry::test::with_captured_events_options(
        || {
            tracing::subscriber::with_default(subscriber, || {
                tracing::error!(
                    target: AGENT_STDERR_TRACING_TARGET,
                    "raw child-process stderr"
                );
                tracing::error!("ordinary runtime failure");
            });
        },
        sentry_test_options(),
    );

    assert_eq!(events.len(), 1, "agent stderr must be ignored by Sentry");
    assert_eq!(
        events[0].message.as_deref(),
        Some("ordinary runtime failure")
    );
}

#[test]
fn runtime_incident_reaches_sentry_once_with_stable_scrubbed_context() {
    use tracing_subscriber::layer::SubscriberExt;

    let subscriber = tracing_subscriber::registry()
        .with(sentry_tracing::layer().event_mapper(sentry_event_mapper));
    let events = sentry::test::with_captured_events_options(
        || {
            tracing::subscriber::with_default(subscriber, || {
                sentry::configure_scope(|scope| {
                    scope.set_tag("runtime_env", "e2b");
                    scope.set_tag("org_id", "org-1");
                    scope.set_tag("sandbox_id", "provider-sandbox-1");
                    scope.set_tag("target_id", "cloud-sandbox-1");
                    scope.set_user(Some(User {
                        id: Some("user-1".to_string()),
                        email: Some("private@example.com".to_string()),
                        ..Default::default()
                    }));
                });
                sentry::add_breadcrumb(Breadcrumb {
                    message: Some(
                        "request at /Users/customer/private.txt with Bearer breadcrumb-secret"
                            .to_string(),
                    ),
                    data: BTreeMap::from([
                        (
                            "request_id".to_string(),
                            Value::String("request-1".to_string()),
                        ),
                        (
                            "request_body".to_string(),
                            Value::String("raw prompt".to_string()),
                        ),
                    ]),
                    ..Default::default()
                });

                let request_span = tracing::info_span!(
                    "runtime_request",
                    request_id = "request-1",
                    authorization = "Bearer span-secret",
                    request_body = "raw request prompt"
                );
                let _request_guard = request_span.enter();
                let flow_span =
                    tracing::info_span!("session_flow", flow_id = "flow-1", prompt_id = "prompt-1");
                let _flow_guard = flow_span.enter();

                tracing::error!(
                    target: RUNTIME_INCIDENT_TRACING_TARGET,
                    incident_id = "incident-1",
                    error_code = "SESSION_MODEL_GATED",
                    fingerprint = "anyharness:session_model_gated",
                    workspace_id = "workspace-1",
                    attempted_session_id = "session-1",
                    agent_kind = "claude",
                    requested_model = "haiku",
                    canonical_model = "claude-haiku-4-5",
                    active_contexts = "anthropic-api-key",
                    required_contexts = "anthropic-api-key",
                    catalog_version = "catalog-1",
                    selection_outcome = "model_gated",
                    effective_model = "none",
                    effective_route = "none",
                    provider_output = "raw provider secret",
                    "handled runtime incident"
                );
            });
        },
        sentry_test_options(),
    );

    assert_eq!(events.len(), 1, "one request owns one runtime incident");
    let event = &events[0];
    assert_eq!(event.level, sentry::Level::Error);
    assert_eq!(
        event.logger.as_deref(),
        Some(RUNTIME_INCIDENT_TRACING_TARGET)
    );
    assert_eq!(event.message.as_deref(), Some("handled runtime incident"));
    assert_eq!(event.release.as_deref(), Some("anyharness@test"));
    assert_eq!(event.environment.as_deref(), Some("test"));
    assert_eq!(event.fingerprint.len(), 1);
    assert_eq!(event.fingerprint[0].as_ref(), RUNTIME_INCIDENT_FINGERPRINT);

    let fields = match event.contexts.get("Rust Tracing Fields") {
        Some(SentryContext::Other(fields)) => fields,
        other => panic!("expected tracing fields context, got {other:?}"),
    };
    assert_eq!(string_field(fields, "incident_id"), "incident-1");
    assert_eq!(string_field(fields, "error_code"), "SESSION_MODEL_GATED");
    assert_eq!(
        string_field(fields, "fingerprint"),
        RUNTIME_INCIDENT_FINGERPRINT
    );
    assert_eq!(string_field(fields, "workspace_id"), "workspace-1");
    assert_eq!(string_field(fields, "attempted_session_id"), "session-1");
    assert_eq!(string_field(fields, "requested_model"), "haiku");
    assert_eq!(string_field(fields, "canonical_model"), "claude-haiku-4-5");
    assert_eq!(string_field(fields, "effective_model"), "none");
    assert_eq!(string_field(fields, "effective_route"), "none");
    assert_eq!(
        string_field(fields, "runtime_request:request_id"),
        "request-1"
    );
    assert_eq!(string_field(fields, "session_flow:flow_id"), "flow-1");
    assert_eq!(string_field(fields, "session_flow:prompt_id"), "prompt-1");
    assert!(!fields.contains_key("provider_output"));
    assert!(!fields.contains_key("runtime_request:authorization"));
    assert!(!fields.contains_key("runtime_request:request_body"));

    assert_eq!(
        event.tags.get("runtime_env").map(String::as_str),
        Some("e2b")
    );
    assert_eq!(event.tags.get("org_id").map(String::as_str), Some("org-1"));
    assert_eq!(
        event.tags.get("sandbox_id").map(String::as_str),
        Some("provider-sandbox-1")
    );
    assert_eq!(
        event.tags.get("target_id").map(String::as_str),
        Some("cloud-sandbox-1")
    );
    let user = event.user.as_ref().expect("ID-only user context");
    assert_eq!(user.id.as_deref(), Some("user-1"));
    assert!(user.email.is_none());

    assert_eq!(event.breadcrumbs.len(), 1);
    let breadcrumb = &event.breadcrumbs[0];
    let message = breadcrumb.message.as_deref().expect("breadcrumb message");
    assert!(!message.contains("breadcrumb-secret"));
    assert!(!message.contains("/Users/customer"));
    assert_eq!(string_field(&breadcrumb.data, "request_id"), "request-1");
    assert!(!breadcrumb.data.contains_key("request_body"));
}

#[test]
fn agent_stderr_filter_ignores_every_sentry_signal_type() {
    let all_signal_types = sentry_tracing::EventFilter::Event
        | sentry_tracing::EventFilter::Breadcrumb
        | sentry_tracing::EventFilter::Log;

    let filter = sentry_event_filter_for_target(AGENT_STDERR_TRACING_TARGET, all_signal_types);

    assert!(
        filter.is_empty(),
        "agent stderr must map to EventFilter::Ignore"
    );
}

#[test]
fn sentry_scope_tags_include_runtime_surface_and_mode() {
    let tags = sentry_scope_tags();
    assert!(tags
        .iter()
        .any(|(k, v)| *k == "surface" && v == "anyharness_runtime"));
    assert!(tags
        .iter()
        .any(|(k, v)| *k == "telemetry_mode" && v == "hosted_product"));
    assert!(tags
        .iter()
        .any(|(k, v)| *k == "runtime_env" && !v.is_empty()));
}

#[test]
fn default_release_is_canonical_for_this_component() {
    let release = default_release();
    assert!(release.starts_with("anyharness@"), "{release}");
    let expected = match stamped_git_sha() {
        Some(sha) => {
            assert_eq!(sha.len(), 12);
            format!("anyharness@{}+{sha}", env!("PROLIFERATE_STAMPED_VERSION"))
        }
        None => format!("anyharness@{}", env!("PROLIFERATE_STAMPED_VERSION")),
    };
    assert_eq!(release, expected);
}

#[test]
fn sentry_user_context_is_id_only_and_trimmed() {
    let user = sentry_user_from_id(Some("  user-1  ")).expect("user present");
    assert_eq!(user.id.as_deref(), Some("user-1"));
    assert!(user.email.is_none());
    assert!(sentry_user_from_id(None).is_none());
    assert!(sentry_user_from_id(Some("   ")).is_none());
}

#[test]
fn serve_runtime_home_uses_override_when_present() {
    let args = ServeArgs {
        host: "127.0.0.1".to_string(),
        port: 8457,
        runtime_home: Some("/tmp/anyharness-test".to_string()),
        require_bearer_auth: false,
        disable_cors: false,
    };

    assert_eq!(
        runtime_home_from_serve(&args).to_string_lossy(),
        "/tmp/anyharness-test"
    );
}

#[test]
fn install_runtime_home_uses_override_when_present() {
    let args = InstallAgentsArgs {
        runtime_home: Some("/tmp/anyharness-install".to_string()),
        reinstall: false,
        agents: Vec::new(),
    };

    assert_eq!(
        runtime_home_from_install(&args).to_string_lossy(),
        "/tmp/anyharness-install"
    );
}

#[test]
fn print_openapi_has_no_file_log_path() {
    assert!(log_path_for_command(&Commands::PrintOpenapi).is_none());
}

#[test]
fn serve_command_log_path_lands_under_runtime_home_logs() {
    let path = log_path_for_command(&Commands::Serve(ServeArgs {
        host: "127.0.0.1".to_string(),
        port: 8457,
        runtime_home: Some("/tmp/anyharness-serve".to_string()),
        require_bearer_auth: false,
        disable_cors: false,
    }))
    .expect("serve should use file logging");

    assert_eq!(
        path.to_string_lossy(),
        "/tmp/anyharness-serve/logs/anyharness.log"
    );
}

#[test]
fn install_command_log_path_lands_under_runtime_home_logs() {
    let path = log_path_for_command(&Commands::InstallAgents(InstallAgentsArgs {
        runtime_home: Some("/tmp/anyharness-install".to_string()),
        reinstall: false,
        agents: Vec::new(),
    }))
    .expect("install should use file logging");

    assert_eq!(
        path.to_string_lossy(),
        "/tmp/anyharness-install/logs/anyharness.log"
    );
}
