use std::{borrow::Cow, path::PathBuf, sync::Arc, time::Duration};

use anyharness_lib::{
    app::default_runtime_home,
    observability::{
        AGENT_STDERR_TRACING_TARGET, PRODUCT_MCP_AUTH_REJECTED_TRACING_TARGET,
        RUNTIME_INCIDENT_TRACING_TARGET, WORKFLOW_BOOT_FENCE_TRACING_TARGET,
        WORKFLOW_INTERJECTION_HELD_TRACING_TARGET, WORKFLOW_INVARIANT_VIOLATION_TRACING_TARGET,
        WORKFLOW_NODE_INTERACTION_REQUESTED_TRACING_TARGET,
        WORKFLOW_NODE_INTERACTION_RESOLVED_TRACING_TARGET, WORKFLOW_NODE_LAUNCHED_TRACING_TARGET,
        WORKFLOW_NODE_LAUNCH_FAILED_TRACING_TARGET, WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET,
        WORKFLOW_RUN_ACCEPTED_TRACING_TARGET, WORKFLOW_RUN_FINISHED_TRACING_TARGET,
        WORKFLOW_RUN_STARTED_TRACING_TARGET, WORKFLOW_TRANSITION_ILLEGAL_TRACING_TARGET,
        WORKFLOW_TRANSITION_TRACING_TARGET, WORKFLOW_WORKSPACE_MATERIALIZED_TRACING_TARGET,
    },
};
use proliferate_diagnostics_client::{
    install_desktop_producer, BundledDesktopDiagnosticsBootstrap, DesktopDiagnosticsActivation,
    DiagnosticsComponent, DiagnosticsProducerGuard, TargetMapping, TargetMappingConfig,
};
use proliferate_diagnostics_protocol::v1::types::StandardStreamV1;
use tracing::Subscriber;
use tracing_subscriber::{
    layer::{Context as LayerContext, SubscriberExt},
    registry::LookupSpan,
    util::SubscriberInitExt,
    Layer,
};

use crate::{
    cli::Commands,
    commands::{install_agents::InstallAgentsArgs, serve::ServeArgs},
    file_logging::create_file_log_sink,
};

mod log_format;
mod scrub;
mod session_tag;

use session_tag::{session_id_for_event, SessionIdSpanLayer, SESSION_ID_SPAN_FIELD};

use log_format::{log_format_from_env, LogFormat};

const ANYHARNESS_TELEMETRY_MODE: &str = "hosted_product";
const ANYHARNESS_RECORD_NAME_PREFIX: &str = "anyharness.";
const RUNTIME_ENV_TAG: &str = "runtime_env";
const RUNTIME_INCIDENT_FINGERPRINT: &str = "anyharness:runtime_incident";

#[derive(Clone)]
struct ScrubbedTransportFactory;

impl sentry::TransportFactory for ScrubbedTransportFactory {
    fn create_transport_with_options(
        &self,
        options: sentry::TransportOptions,
    ) -> Arc<dyn sentry::Transport> {
        let inner = sentry::TransportFactory::create_transport_with_options(
            &sentry::transports::DefaultTransportFactory,
            options,
        );
        Arc::new(ScrubbedTransport { inner })
    }
}

struct ScrubbedTransport {
    inner: Arc<dyn sentry::Transport>,
}

impl sentry::Transport for ScrubbedTransport {
    fn send_envelope(&self, envelope: sentry::Envelope) {
        self.inner.send_envelope(scrub::envelope(envelope));
    }

    fn flush(&self, timeout: Duration) -> bool {
        self.inner.flush(timeout)
    }

    fn shutdown(&self, timeout: Duration) -> bool {
        self.inner.shutdown(timeout)
    }
}

pub struct TelemetryGuards {
    _sentry: Option<sentry::ClientInitGuard>,
    _file_log: Option<tracing_appender::non_blocking::WorkerGuard>,
    diagnostics: Option<DiagnosticsProducerGuard>,
}

impl TelemetryGuards {
    pub async fn shutdown(mut self, deadline: Duration) {
        if let Some(guard) = self.diagnostics.take() {
            let _ = guard.shutdown(deadline).await;
        }
    }
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// The build SHA stamped by `build.rs`, or `None` for an unstamped dev build.
fn stamped_git_sha() -> Option<&'static str> {
    let sha = env!("PROLIFERATE_STAMPED_GIT_SHA");
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

/// This binary's canonical release ID: `anyharness@<version>+<12-char-sha>`.
/// The SHA is omitted only for an unstamped local/dev build.
fn default_release() -> String {
    let version = env!("PROLIFERATE_STAMPED_VERSION");
    match stamped_git_sha() {
        Some(sha) => format!("anyharness@{version}+{sha}"),
        None => format!("anyharness@{version}"),
    }
}

fn sample_rate(key: &str, default: f32) -> f32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(default)
}

fn env_filter_from_env() -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())
}

fn sentry_event_filter_for_target(
    target: &str,
    default_filter: sentry_tracing::EventFilter,
) -> sentry_tracing::EventFilter {
    if target == AGENT_STDERR_TRACING_TARGET {
        sentry_tracing::EventFilter::Ignore
    } else {
        default_filter
    }
}

fn sentry_event_filter(metadata: &tracing::Metadata<'_>) -> sentry_tracing::EventFilter {
    sentry_event_filter_for_target(
        metadata.target(),
        sentry_tracing::default_event_filter(metadata),
    )
}

fn sentry_event_mapper<S>(
    event: &tracing::Event<'_>,
    context: LayerContext<'_, S>,
) -> sentry_tracing::EventMapping
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
{
    let filter = sentry_event_filter(event.metadata());
    if filter.is_empty() {
        return sentry_tracing::EventMapping::Ignore;
    }

    // The prior event-filter layer left span-attribute inheritance disabled,
    // so ordinary events continue without parent span fields; Sentry's active
    // scope still supplies their trace context. Only the incident target opts
    // into bounded request/flow fields from active spans.
    let is_runtime_incident = event.metadata().target() == RUNTIME_INCIDENT_TRACING_TARGET;
    let span_context = is_runtime_incident.then_some(&context);
    let mut mappings = Vec::new();

    if filter.contains(sentry_tracing::EventFilter::Breadcrumb) {
        mappings.push(sentry_tracing::EventMapping::Breadcrumb(
            sentry_tracing::breadcrumb_from_event(event, span_context),
        ));
    }
    if filter.contains(sentry_tracing::EventFilter::Event) {
        let mut sentry_event = sentry_tracing::event_from_event(event, span_context);
        if is_runtime_incident {
            sentry_event.fingerprint =
                Cow::Owned(vec![Cow::Borrowed(RUNTIME_INCIDENT_FINGERPRINT)]);
        }
        if let Some(session_id) = session_id_for_event(event, &context) {
            sentry_event
                .tags
                .insert(SESSION_ID_SPAN_FIELD.to_string(), session_id);
        }
        mappings.push(sentry_tracing::EventMapping::Event(sentry_event));
    }
    if filter.contains(sentry_tracing::EventFilter::Log) {
        mappings.push(sentry_tracing::EventMapping::Log(
            sentry_tracing::log_from_event(event, span_context),
        ));
    }

    sentry_tracing::EventMapping::Combined(mappings.into())
}

fn runtime_home_from_serve(args: &ServeArgs) -> PathBuf {
    args.runtime_home
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_runtime_home)
}

fn runtime_home_from_install(args: &InstallAgentsArgs) -> PathBuf {
    args.runtime_home
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_runtime_home)
}

fn log_path_for_command(command: &Commands) -> Option<PathBuf> {
    match command {
        Commands::Serve(args) => Some(runtime_home_from_serve(args).join("logs/anyharness.log")),
        Commands::InstallAgents(args) => {
            Some(runtime_home_from_install(args).join("logs/anyharness.log"))
        }
        Commands::PrintOpenapi => None,
        Commands::CatalogProbe(_) => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BundledActivation {
    Ready,
    Degraded,
}

/// Pure: whether a bundled `serve` run suppresses the legacy `anyharness.log`
/// sink.
///
/// A degraded bootstrap suppresses unconditionally: the Desktop bridge still
/// owns this run's diagnostics authority, and the producer refuses to install
/// at all unless it holds a validated fallback family. A collector-ready
/// bootstrap suppresses only once its producer is actually installed, because
/// installation can still fail on the bridge runtime or the record factory.
/// Suppressing there would leave a packaged run with no diagnostics whatsoever:
/// no diagnostics layer, no `anyharness.log`, and an inherited stdio the
/// console layer is discarded into.
fn suppresses_legacy_file_sink(activation: BundledActivation, installed: bool) -> bool {
    match activation {
        BundledActivation::Ready => installed,
        BundledActivation::Degraded => true,
    }
}

pub fn init(command: &Commands, activation: DesktopDiagnosticsActivation) -> TelemetryGuards {
    let dsn = std::env::var("ANYHARNESS_SENTRY_DSN")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let telemetry = dsn.map(|dsn| {
        sentry::init((
            dsn,
            sentry::ClientOptions {
                environment: Some(
                    env_or_default("ANYHARNESS_SENTRY_ENVIRONMENT", "production").into(),
                ),
                release: Some(
                    env_or_default("ANYHARNESS_SENTRY_RELEASE", &default_release()).into(),
                ),
                traces_sample_rate: sample_rate("ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE", 1.0),
                attach_stacktrace: true,
                send_default_pii: false,
                server_name: Some(scrub::SAFE_SERVER_NAME.into()),
                before_send: Some(Arc::new(scrub::event)),
                before_breadcrumb: Some(Arc::new(scrub::breadcrumb)),
                before_send_log: Some(Arc::new(scrub::log)),
                transport: Some(Arc::new(ScrubbedTransportFactory)),
                ..Default::default()
            },
        ))
    });

    let serve_mode = matches!(command, Commands::Serve(_));
    let (bundled, installation) = if serve_mode {
        match activation {
            DesktopDiagnosticsActivation::Disabled => (false, None),
            DesktopDiagnosticsActivation::Bundled(bootstrap) => {
                let installation =
                    install_local(BundledDesktopDiagnosticsBootstrap::Ready(bootstrap));
                (
                    suppresses_legacy_file_sink(BundledActivation::Ready, installation.is_some()),
                    installation,
                )
            }
            DesktopDiagnosticsActivation::BundledDegraded(bootstrap) => {
                let installation =
                    install_local(BundledDesktopDiagnosticsBootstrap::Degraded(bootstrap));
                (
                    suppresses_legacy_file_sink(
                        BundledActivation::Degraded,
                        installation.is_some(),
                    ),
                    installation,
                )
            }
            // The dev fallback owns no bridge and makes no claim over this
            // process's logging, so file logging stays exactly as it was.
            #[cfg(debug_assertions)]
            DesktopDiagnosticsActivation::DevEnv(bootstrap) => (
                false,
                install_local(BundledDesktopDiagnosticsBootstrap::DevEnv(bootstrap)),
            ),
        }
    } else {
        (false, None)
    };
    let file_sink = (!bundled)
        .then(|| log_path_for_command(command))
        .flatten()
        .and_then(|path| match create_file_log_sink(&path) {
            Ok(sink) => Some(sink),
            Err(error) => {
                eprintln!(
                    "[anyharness] file logging disabled for {}: {error}",
                    path.display()
                );
                None
            }
        });

    // One format decision per process, applied to every fmt sink: JSON when a
    // machine is the reader (cloud runtime env), human text locally.
    let log_format = log_format_from_env();
    let console_layer: Box<dyn Layer<tracing_subscriber::Registry> + Send + Sync> = match log_format
    {
        LogFormat::Json => tracing_subscriber::fmt::layer()
            .json()
            .with_filter(env_filter_from_env())
            .boxed(),
        LogFormat::Text => tracing_subscriber::fmt::layer()
            .with_filter(env_filter_from_env())
            .boxed(),
    };

    let (diagnostics_layer, diagnostics) = match installation {
        Some(installation) => {
            let admission = anyharness_target_mappings();
            (
                Some(
                    installation
                        .layer
                        .with_target_mappings(anyharness_target_mappings())
                        .with_filter(tracing_subscriber::filter::FilterFn::new(move |metadata| {
                            admission.admits(metadata.target(), metadata.level())
                        })),
                ),
                Some(installation.guard),
            )
        }
        None => (None, None),
    };

    tracing_subscriber::registry()
        .with(console_layer)
        .with(SessionIdSpanLayer)
        .with(sentry_tracing::layer().event_mapper(sentry_event_mapper))
        .with(diagnostics_layer)
        .with(file_sink.as_ref().map(|sink| {
            let layer: Box<dyn Layer<_> + Send + Sync> = match log_format {
                LogFormat::Json => tracing_subscriber::fmt::layer()
                    .json()
                    .with_ansi(false)
                    .with_writer(sink.writer.clone())
                    .with_filter(env_filter_from_env())
                    .boxed(),
                LogFormat::Text => tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(sink.writer.clone())
                    .with_filter(env_filter_from_env())
                    .boxed(),
            };
            layer
        }))
        .init();

    if telemetry.is_some() {
        sentry::configure_scope(|scope| {
            for (key, value) in &sentry_scope_tags() {
                scope.set_tag(key, value);
            }
            if let Some(user) = sentry_user_from_env() {
                scope.set_user(Some(user));
            }
        });
    }

    if let Some(sink) = file_sink.as_ref() {
        tracing::info!(log_path = %sink.path.display(), "AnyHarness file logging enabled");
    }

    TelemetryGuards {
        _sentry: telemetry,
        _file_log: file_sink.map(|sink| sink.guard),
        diagnostics,
    }
}

/// Record naming for this component: the two legacy targets keep their
/// rewritten names and kinds, and every other `anyharness.` target names its
/// own record, so adding a named event is only a `target:`.
///
/// The gen-2 workflow targets are spelled with underscores but publish dotted
/// record names, so they stay explicit table entries rather than riding the
/// pass-through prefix.
fn anyharness_target_mappings() -> TargetMappingConfig {
    TargetMappingConfig::new(vec![
        TargetMapping::stdio(
            AGENT_STDERR_TRACING_TARGET,
            "anyharness.agent.stderr",
            StandardStreamV1::Stderr,
        ),
        TargetMapping::span_event(
            RUNTIME_INCIDENT_TRACING_TARGET,
            "anyharness.runtime.incident",
        ),
        TargetMapping::span_event(
            PRODUCT_MCP_AUTH_REJECTED_TRACING_TARGET,
            "anyharness.product_mcp.auth.rejected",
        ),
        TargetMapping::span_event(
            WORKFLOW_RUN_STARTED_TRACING_TARGET,
            "anyharness.workflow.run.started",
        ),
        TargetMapping::span_event(
            WORKFLOW_RUN_ACCEPTED_TRACING_TARGET,
            "anyharness.workflow.run.accepted",
        ),
        TargetMapping::span_event(
            WORKFLOW_WORKSPACE_MATERIALIZED_TRACING_TARGET,
            "anyharness.workflow.workspace.materialized",
        ),
        TargetMapping::span_event(
            WORKFLOW_TRANSITION_TRACING_TARGET,
            "anyharness.workflow.transition",
        ),
        TargetMapping::span_event(
            WORKFLOW_NODE_LAUNCHED_TRACING_TARGET,
            "anyharness.workflow.node.launched",
        ),
        TargetMapping::span_event(
            WORKFLOW_RUN_FINISHED_TRACING_TARGET,
            "anyharness.workflow.run.finished",
        ),
        TargetMapping::span_event(
            WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET,
            "anyharness.workflow.notification.stale",
        ),
        TargetMapping::span_event(
            WORKFLOW_TRANSITION_ILLEGAL_TRACING_TARGET,
            "anyharness.workflow.transition.illegal",
        ),
        TargetMapping::span_event(
            WORKFLOW_NODE_LAUNCH_FAILED_TRACING_TARGET,
            "anyharness.workflow.node.launch_failed",
        ),
        TargetMapping::span_event(
            WORKFLOW_BOOT_FENCE_TRACING_TARGET,
            "anyharness.workflow.boot_fence",
        ),
        TargetMapping::span_event(
            WORKFLOW_INVARIANT_VIOLATION_TRACING_TARGET,
            "anyharness.workflow.invariant_violation",
        ),
        TargetMapping::span_event(
            WORKFLOW_NODE_INTERACTION_REQUESTED_TRACING_TARGET,
            "anyharness.workflow.node.interaction_requested",
        ),
        TargetMapping::span_event(
            WORKFLOW_NODE_INTERACTION_RESOLVED_TRACING_TARGET,
            "anyharness.workflow.node.interaction_resolved",
        ),
        TargetMapping::span_event(
            WORKFLOW_INTERJECTION_HELD_TRACING_TARGET,
            "anyharness.workflow.interjection_held",
        ),
    ])
    .with_passthrough_prefix(ANYHARNESS_RECORD_NAME_PREFIX)
}

fn install_local(
    activation: BundledDesktopDiagnosticsBootstrap,
) -> Option<proliferate_diagnostics_client::DiagnosticsInstallation> {
    let environment = std::env::var("PROLIFERATE_RUNTIME_ENV")
        .ok()
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .unwrap_or_else(|| "local".to_owned());
    match install_desktop_producer(
        DiagnosticsComponent::AnyHarness,
        activation,
        &default_release(),
        &environment,
    ) {
        Ok(installation) => Some(installation),
        Err(_) => {
            eprintln!("[desktop-diagnostics] anyharness adapter unavailable");
            None
        }
    }
}

/// Sentry user context for the authenticated owner, when known.
///
/// This is the canonical identity surface. The `user_id` scope tag added by
/// [`sentry_scope_tags`] remains only as a temporary adapter fallback during
/// the migration to user context (support-system "Sentry users").
fn sentry_user_from_env() -> Option<sentry::User> {
    sentry_user_from_id(std::env::var("PROLIFERATE_USER_ID").ok().as_deref())
}

/// Pure: build Sentry user context from an optional raw user-id value.
fn sentry_user_from_id(raw: Option<&str>) -> Option<sentry::User> {
    let user_id = raw?.trim();
    if user_id.is_empty() {
        return None;
    }
    Some(sentry::User {
        id: Some(user_id.to_string()),
        ..Default::default()
    })
}

fn sentry_scope_tags() -> Vec<(&'static str, String)> {
    let mut tags: Vec<(&'static str, String)> = vec![
        ("surface", "anyharness_runtime".to_string()),
        ("telemetry_mode", ANYHARNESS_TELEMETRY_MODE.to_string()),
    ];

    let runtime_env =
        std::env::var("PROLIFERATE_RUNTIME_ENV").unwrap_or_else(|_| "local".to_string());
    tags.push(("runtime_env", runtime_env));

    if let Ok(org_id) = std::env::var("PROLIFERATE_ORG_ID") {
        if !org_id.trim().is_empty() {
            tags.push(("org_id", org_id));
        }
    }
    if let Ok(sandbox_id) = std::env::var("PROLIFERATE_SANDBOX_ID") {
        if !sandbox_id.trim().is_empty() {
            tags.push(("sandbox_id", sandbox_id));
        }
    }
    if let Ok(user_id) = std::env::var("PROLIFERATE_USER_ID") {
        if !user_id.trim().is_empty() {
            tags.push(("user_id", user_id));
        }
    }
    if let Ok(target_id) = std::env::var("ANYHARNESS_RUNTIME_TARGET_ID") {
        if !target_id.trim().is_empty() {
            tags.push(("target_id", target_id));
        }
    }

    tags
}

#[cfg(test)]
mod tests;
