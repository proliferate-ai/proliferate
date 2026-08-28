//! Same-process hydration and native fork for adapters whose fork ids are
//! process-local. This module owns the wire-ordering and durable dispatch
//! boundary; ordinary load/new startup remains in `native_session.rs`.

use std::path::Path;
use std::sync::Arc;

use anyharness_contract::v1::SessionActionCapabilities;

use super::frame_observer::ForkWireResponse;
use super::inbound::InboundDoor;
use super::native_session::{
    build_system_prompt_meta, merge_targeted_fork_anchor_meta,
    native_fork_anchor_is_dispatch_ready, sanitized_native_fork_failure,
};
use super::types::{NativeSessionStartupDisposition, NativeSessionStartupState};
use super::{acp, to_acp_servers, SessionMcpServer};
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::live::sessions::fork_dispatch::ForkDispatchDurable;

enum OrderedForkResult {
    Created {
        native_session_id: String,
        startup_state: NativeSessionStartupState,
    },
    Failed(&'static str),
}

#[tracing::instrument(
    name = "session.process_local_fork",
    skip_all,
    fields(session_id = %session_id, workspace_id = %workspace_id, fork_kind = "process_local")
)]
#[allow(clippy::too_many_arguments)]
pub(in crate::live::sessions) async fn hydrate_parent_and_fork(
    conn: &acp::ConnectionTo<acp::Agent>,
    inbound: Arc<InboundDoor>,
    durable: Arc<dyn ForkDispatchDurable>,
    workspace_path: &Path,
    mcp_servers: &[SessionMcpServer],
    system_prompt_append: Option<&str>,
    action_capabilities: SessionActionCapabilities,
    fork_operation_id: &str,
    parent_native_session_id: &str,
    provider_anchor: Option<&ProviderForkAnchor>,
    session_id: &str,
    workspace_id: &str,
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
) -> anyhow::Result<(
    String,
    NativeSessionStartupState,
    NativeSessionStartupDisposition,
)> {
    let fork_started = std::time::Instant::now();
    if !action_capabilities.fork {
        return fail_startup(
            ready_tx,
            "preflight",
            "agent does not advertise ACP session/fork with load_session support",
        );
    }
    if !native_fork_anchor_is_dispatch_ready(action_capabilities, provider_anchor) {
        return fail_startup(
            ready_tx,
            "preflight",
            "agent does not advertise targeted fork support for the native anchor",
        );
    }

    // The exact adapter keeps sessions in a process-local map. Hydrate the
    // parent on this fresh child process before asking that same connection to
    // fork it. Parent replay is quarantined by the already-installed epoch.
    tracing::info!(
        fork_stage = "hydrate",
        phase = "started",
        "process-local fork phase"
    );
    let system_prompt_meta = build_system_prompt_meta(system_prompt_append);
    let mut load_request = acp::schema::LoadSessionRequest::new(
        parent_native_session_id.to_string(),
        workspace_path.to_path_buf(),
    )
    .mcp_servers(to_acp_servers(mcp_servers))
    .meta(system_prompt_meta.clone());
    if mcp_servers.is_empty() {
        load_request.mcp_servers.clear();
    }
    if conn.send_request(load_request).block_task().await.is_err() {
        return fail_prepared_startup(
            &*durable,
            fork_operation_id,
            session_id,
            ready_tx,
            "hydrate",
            "ACP parent session hydration failed",
        );
    }
    tracing::info!(
        fork_stage = "hydrate",
        phase = "completed",
        "process-local fork phase"
    );

    // A parent interaction during replay is cancelled by the inbound door and
    // poisons startup. Check before the CAS so this path emits no native fork.
    if inbound.ensure_process_local_fork_startup_clean().is_err() {
        return fail_prepared_startup(
            &*durable,
            fork_operation_id,
            session_id,
            ready_tx,
            "hydrate",
            "ACP parent session hydration requested an interaction",
        );
    }

    // Only now may an unknown non-parent notification be a candidate child
    // frame. Install the bounded pending epoch before the durable claim and
    // before the wire request.
    if inbound.begin_process_local_fork_pending().is_err() {
        return fail_prepared_startup(
            &*durable,
            fork_operation_id,
            session_id,
            ready_tx,
            "epoch",
            "process-local fork pending epoch could not start",
        );
    }

    tracing::info!(
        fork_stage = "claim",
        phase = "started",
        "process-local fork phase"
    );
    let claim_at = chrono::Utc::now().to_rfc3339();
    if durable
        .claim_native_call(fork_operation_id, session_id, &claim_at)
        .is_err()
    {
        return fail_startup(ready_tx, "claim", "durable process-local fork claim failed");
    }
    tracing::info!(
        fork_stage = "claim",
        phase = "completed",
        "process-local fork phase"
    );

    let mut fork_request = acp::schema::ForkSessionRequest::new(
        parent_native_session_id.to_string(),
        workspace_path.to_path_buf(),
    )
    .mcp_servers(to_acp_servers(mcp_servers))
    .meta(merge_targeted_fork_anchor_meta(
        system_prompt_meta,
        provider_anchor,
    ));
    if mcp_servers.is_empty() {
        fork_request.mcp_servers.clear();
    }

    tracing::info!(
        fork_stage = "wire_dispatch",
        phase = "started",
        "process-local fork phase"
    );
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    let callback_child_id = session_id.to_string();
    let callback_operation_id = fork_operation_id.to_string();
    let callback_parent_native_id = parent_native_session_id.to_string();
    let callback_durable = durable.clone();
    let callback_inbound = inbound.clone();
    let scheduled = conn.send_request(fork_request).on_receiving_result(
        move |result: acp::Result<acp::schema::ForkSessionResponse>| async move {
            let outcome = match result {
                Ok(response)
                    if callback_inbound.fork_wire_response()
                        == ForkWireResponse::ResultEnvelope =>
                {
                    let native_session_id = response.session_id.to_string();
                    if native_session_id.trim().is_empty()
                        || native_session_id == callback_parent_native_id
                    {
                        park_unknown(
                            &*callback_durable,
                            &callback_operation_id,
                            &callback_child_id,
                        )?;
                        OrderedForkResult::Failed("ACP session/fork outcome was invalid")
                    } else {
                        let result_at = chrono::Utc::now().to_rfc3339();
                        if callback_durable
                            .record_native_result(
                                &callback_operation_id,
                                &callback_child_id,
                                &native_session_id,
                                &result_at,
                            )
                            .is_err()
                        {
                            let _ = park_unknown(
                                &*callback_durable,
                                &callback_operation_id,
                                &callback_child_id,
                            );
                            OrderedForkResult::Failed(
                                "durable process-local fork result transition failed",
                            )
                        } else if callback_inbound
                            .adopt_process_local_fork_child(&native_session_id)
                            .is_err()
                        {
                            OrderedForkResult::Failed("process-local fork child adoption failed")
                        } else {
                            OrderedForkResult::Created {
                                native_session_id,
                                startup_state: NativeSessionStartupState::from_fork_session(
                                    &response,
                                ),
                            }
                        }
                    }
                }
                Ok(_response) => {
                    let _ = park_unknown(
                        &*callback_durable,
                        &callback_operation_id,
                        &callback_child_id,
                    );
                    OrderedForkResult::Failed("ACP session/fork outcome was malformed")
                }
                Err(error)
                    if callback_inbound.fork_wire_response() == ForkWireResponse::ExplicitError =>
                {
                    let failed_at = chrono::Utc::now().to_rfc3339();
                    let _ = callback_durable.fail_in_flight(
                        &callback_operation_id,
                        &callback_child_id,
                        &failed_at,
                    );
                    let (detail, _failure_class) = sanitized_native_fork_failure(&error);
                    OrderedForkResult::Failed(detail)
                }
                Err(_error) => {
                    let _ = park_unknown(
                        &*callback_durable,
                        &callback_operation_id,
                        &callback_child_id,
                    );
                    OrderedForkResult::Failed("ACP session/fork outcome was malformed")
                }
            };
            let _ = result_tx.send(outcome);
            Ok(())
        },
    );

    if scheduled.is_err() {
        let _ = park_unknown(&*durable, fork_operation_id, session_id);
        return fail_startup(
            ready_tx,
            "wire_dispatch",
            "ACP session/fork outcome is unknown",
        );
    }

    let outcome = match result_rx.await {
        Ok(outcome) => outcome,
        Err(_) => {
            let _ = park_unknown(&*durable, fork_operation_id, session_id);
            return fail_startup(
                ready_tx,
                "wire_result",
                "ACP session/fork outcome is unknown",
            );
        }
    };

    match outcome {
        OrderedForkResult::Created {
            native_session_id,
            startup_state,
        } => {
            tracing::info!(
                fork_stage = "wire_result",
                phase = "completed",
                "process-local fork phase"
            );
            // Requests or unexpected ids can arrive while the ordered result
            // callback is completing. Preserve the known result but refuse to
            // publish a ready actor when the startup epoch was poisoned.
            if inbound.ensure_process_local_fork_startup_clean().is_err() {
                return fail_startup(
                    ready_tx,
                    "finalize_handoff",
                    "ACP process-local fork startup received quarantined traffic",
                );
            }
            tracing::info!(
                fork_stage = "finalize_handoff",
                phase = "completed",
                native_startup_disposition = NativeSessionStartupDisposition::CreatedFresh.as_str(),
                elapsed_ms = fork_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.process_local_fork.completed"
            );
            Ok((
                native_session_id,
                startup_state,
                NativeSessionStartupDisposition::CreatedFresh,
            ))
        }
        OrderedForkResult::Failed(detail) => fail_startup(ready_tx, "wire_result", detail),
    }
}

fn fail_prepared_startup<T>(
    durable: &dyn ForkDispatchDurable,
    operation_id: &str,
    child_session_id: &str,
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
    stage: &'static str,
    detail: &'static str,
) -> anyhow::Result<T> {
    if fail_prepared(durable, operation_id, child_session_id).is_err() {
        return fail_startup(
            ready_tx,
            stage,
            "durable process-local fork failure transition failed",
        );
    }
    fail_startup(ready_tx, stage, detail)
}

fn fail_prepared(
    durable: &dyn ForkDispatchDurable,
    operation_id: &str,
    child_session_id: &str,
) -> anyhow::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    durable
        .fail_prepared(operation_id, child_session_id, &now)
        .map_err(|_| anyhow::anyhow!("durable process-local fork failure transition failed"))
}

fn park_unknown(
    durable: &dyn ForkDispatchDurable,
    operation_id: &str,
    child_session_id: &str,
) -> acp::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    durable
        .park_outcome_unknown(operation_id, child_session_id, &now)
        .map_err(|_| acp::Error::internal_error())
}

fn fail_startup<T>(
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
    stage: &'static str,
    detail: &'static str,
) -> anyhow::Result<T> {
    tracing::warn!(
        fork_stage = stage,
        failure_class = "process_local_fork_startup_failed",
        "process-local fork startup failed"
    );
    let _ = ready_tx.send(Err(anyhow::anyhow!(detail)));
    Err(anyhow::anyhow!(detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_wire_observer_can_classify_an_explicit_provider_error() {
        assert_ne!(ForkWireResponse::None, ForkWireResponse::ExplicitError);
        assert_ne!(
            ForkWireResponse::ResultEnvelope,
            ForkWireResponse::ExplicitError
        );
    }
}
