use std::sync::Arc;

use agent_client_protocol as acp;
use agent_client_protocol::{JsonRpcMessage, JsonRpcResponse};
use futures::{AsyncBufReadExt, AsyncWriteExt, StreamExt};
use tokio::sync::oneshot;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::live::sessions::driver::frame_observer::{FrameObserver, ProtectedResponseKind};
use crate::live::sessions::driver::frame_tee::{log_frame, FrameDirection};
use crate::live::sessions::driver::inbound::{cancelled_permission_response, InboundDoor};

/// Establishes the ACP client connection over the agent's stdio: registers the
/// four inbound handlers, spawns the connect future on the per-session
/// LocalSet, and extracts the `ConnectionTo` handle. The returned shutdown
/// sender keeps the connection alive; dropping it ends the connect_with
/// closure and shuts the connection task down.
pub(in crate::live::sessions) async fn establish_connection(
    client: Arc<InboundDoor>,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
) -> anyhow::Result<(acp::ConnectionTo<acp::Agent>, oneshot::Sender<()>)> {
    // Channel to extract ConnectionTo<Agent> from within the builder closure.
    let (cx_tx, cx_rx) = oneshot::channel::<acp::ConnectionTo<acp::Agent>>();
    // Shutdown channel: sender is held by the actor and dropped when the actor
    // shuts down, causing the connect_with closure to exit.
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // `Lines` is the same transport `ByteStreams` builds internally (newline
    // framing over the child's stdio); taking it directly is what makes the
    // per-frame tee possible without re-serializing anything.
    let recv_session_id = client.session_id.clone();
    let recv_observer = client.frame_observer();
    let recv_client = client.clone();
    let incoming = Box::pin(futures::io::BufReader::new(stdout.compat()).lines().map(
        move |line| match line {
            Ok(line) => {
                log_frame(
                    &recv_observer,
                    &recv_session_id,
                    FrameDirection::Recv,
                    &line,
                );
                let result = validate_protected_incoming_line(&recv_observer, line);
                if result.is_err() && recv_observer.payloads_protected() {
                    recv_client.quarantine_unscoped_request();
                }
                result
            }
            Err(error) => Err(error),
        },
    ));
    let send_observer = client.frame_observer();
    let outgoing = futures::sink::unfold(
        (
            Box::pin(stdin.compat_write()),
            client.session_id.clone(),
            send_observer,
        ),
        async move |(mut writer, session_id, observer), line: String| {
            if !log_frame(&observer, &session_id, FrameDirection::Send, &line) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "protected ACP request limit exceeded",
                ));
            }
            let mut bytes = line.into_bytes();
            bytes.push(b'\n');
            writer.write_all(&bytes).await?;
            Ok::<_, std::io::Error>((writer, session_id, observer))
        },
    );
    let transport = acp::Lines::new(outgoing, incoming);

    // Captured for the connection-ended record: the handlers below consume
    // their own clones of the door, and the shutdown task outlives them.
    let session_id = client.session_id.clone();
    let live_session_handle = client.live_session_handle.clone();
    let client_for_close = client.clone();

    let client_for_notif = client.clone();
    let client_for_perm = client.clone();
    let client_for_ext = client.clone();
    let client_for_elicitation = client.clone();

    let connect_future =
        acp::Client
            .builder()
            .on_receive_notification(
                async move |notif: acp::schema::SessionNotification, _cx| {
                    client_for_notif.handle_session_notification(notif).await
                },
                acp::on_receive_notification!(),
            )
            .on_receive_request(
                async move |req: acp::schema::RequestPermissionRequest,
                            responder: acp::Responder<acp::schema::RequestPermissionResponse>,
                            _cx| {
                    let result = client_for_perm.handle_request_permission(req).await;
                    let response_policy = ProviderResponsePolicy::for_door(&client_for_perm);
                    responder.respond_with_result(project_protected_response(
                        result,
                        response_policy,
                        cancelled_permission_response,
                    ))
                },
                acp::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::schema::CreateElicitationRequest,
                            responder: acp::Responder<acp::schema::CreateElicitationResponse>,
                            _cx| {
                    let result = client_for_elicitation.standard_mcp_elicitation(req).await;
                    let response_policy = ProviderResponsePolicy::for_door(&client_for_elicitation);
                    responder.respond_with_result(project_protected_response(
                        result,
                        response_policy,
                        || {
                            acp::schema::CreateElicitationResponse::new(
                                acp::schema::ElicitationAction::Cancel,
                            )
                        },
                    ))
                },
                acp::on_receive_request!(),
            )
            .on_receive_request(
                async move |req: acp::AgentRequest,
                            responder: acp::Responder<serde_json::Value>,
                            _cx| {
                    let response_policy = ProviderResponsePolicy::for_door(&client_for_ext);
                    match req {
                        acp::AgentRequest::ExtMethodRequest(ext_req) => {
                            let result = client_for_ext.handle_ext_request(ext_req).await.and_then(
                                |ext_resp| {
                                    serde_json::to_value(&ext_resp.0).map_err(|error| {
                                        acp::Error::internal_error().data(error.to_string())
                                    })
                                },
                            );
                            responder.respond_with_result(project_protected_response(
                                result,
                                response_policy,
                                || serde_json::json!({}),
                            ))
                        }
                        _ => {
                            client_for_ext.quarantine_unscoped_request();
                            responder.respond_with_result(project_protected_response(
                                Err(acp::Error::method_not_found()),
                                response_policy,
                                || serde_json::json!({}),
                            ))
                        }
                    }
                },
                acp::on_receive_request!(),
            )
            .connect_with(
                transport,
                move |cx: acp::ConnectionTo<acp::Agent>| async move {
                    let _ = cx_tx.send(cx);
                    // Keep the connection alive until the actor shuts down (shutdown_tx dropped).
                    let _ = shutdown_rx.await;
                    Ok(())
                },
            );

    tokio::task::spawn_local(async move {
        let result = connect_future.await;
        let response_policy = ProviderResponsePolicy::for_door(&client_for_close);
        client_for_close.close_process_local_fork_epoch();
        if let Err(e) = result {
            if let Some(error) = connection_error_detail(&e, response_policy) {
                tracing::warn!(
                    target: "anyharness.agent.process_exited",
                    session_id = %session_id,
                    during_turn = live_session_handle.is_busy(),
                    error = %error,
                    "ACP connection ended"
                );
            } else {
                tracing::warn!(
                    target: "anyharness.agent.process_exited",
                    session_id = %session_id,
                    during_turn = live_session_handle.is_busy(),
                    failure_class = "process_local_fork_connection_ended",
                    failure_stage = "acp_connection",
                    "ACP connection ended"
                );
            }
        }
    });

    let conn = cx_rx
        .await
        .map_err(|_| anyhow::anyhow!("ACP connection closed before sending context"))?;
    Ok((conn, shutdown_tx))
}

#[derive(Clone, Copy)]
enum ProviderResponsePolicy {
    Ordinary,
    ProcessLocalFork,
}

impl ProviderResponsePolicy {
    fn for_door(door: &InboundDoor) -> Self {
        if door.protects_provider_payloads() {
            Self::ProcessLocalFork
        } else {
            Self::Ordinary
        }
    }

    fn protects_provider_payloads(self) -> bool {
        matches!(self, Self::ProcessLocalFork)
    }
}

/// ACP's outgoing actor records request IDs, methods, and errors at WARN when
/// a responder receives `Err`. Protected fork connections always substitute a
/// fixed typed success, while ordinary sessions retain their existing errors.
fn project_protected_response<T>(
    result: acp::Result<T>,
    response_policy: ProviderResponsePolicy,
    fallback: impl FnOnce() -> T,
) -> acp::Result<T> {
    if response_policy.protects_provider_payloads() {
        Ok(result.unwrap_or_else(|_| fallback()))
    } else {
        result
    }
}

fn connection_error_detail(
    error: &impl std::fmt::Display,
    response_policy: ProviderResponsePolicy,
) -> Option<String> {
    matches!(response_policy, ProviderResponsePolicy::Ordinary).then(|| error.to_string())
}

/// ACP's line transport attaches a raw line to parse-error data before its
/// protocol actor logs the error. Protected process-local fork connections
/// preflight with ACP's own public envelope type and terminate the stream with
/// fixed text, so malformed provider bytes never reach that diagnostic path.
fn validate_protected_incoming_line(
    observer: &FrameObserver,
    line: String,
) -> std::io::Result<String> {
    if !observer.payloads_protected() {
        return Ok(line);
    }

    let message = serde_json::from_str::<acp::jsonrpcmsg::Message>(&line)
        .map_err(|_| protected_input_error())?;
    match message {
        acp::jsonrpcmsg::Message::Response(mut response) => {
            let response_id = response
                .id
                .as_ref()
                .and_then(|id| serde_json::to_value(id).ok())
                .ok_or_else(protected_input_error)?;
            let response_kind = observer
                .take_protected_response_kind(&response_id)
                .ok_or_else(protected_input_error)?;
            match (&response.result, &response.error) {
                (Some(result), None) => {
                    if let ProtectedResponseKind::StandardAcp(method) = response_kind {
                        acp::AgentResponse::from_value(method, result.clone())
                            .map_err(|_| protected_input_error())?;
                    }
                }
                (None, Some(_)) => {
                    let error = response.error.as_mut().expect("matched protected error");
                    error.message = "protected ACP request failed".to_string();
                    error.data = None;
                    return serde_json::to_string(&acp::jsonrpcmsg::Message::Response(response))
                        .map_err(|_| protected_input_error());
                }
                _ => return Err(protected_input_error()),
            }
        }
        acp::jsonrpcmsg::Message::Request(request) => {
            let valid = if request.id.is_some() {
                match request.method.as_str() {
                    "session/request_permission" => {
                        acp::schema::RequestPermissionRequest::parse_message(
                            &request.method,
                            &request.params,
                        )
                        .is_ok()
                    }
                    "elicitation/create" => acp::schema::CreateElicitationRequest::parse_message(
                        &request.method,
                        &request.params,
                    )
                    .is_ok(),
                    method if method.starts_with('_') => {
                        acp::schema::AgentRequest::parse_message(&request.method, &request.params)
                            .is_ok()
                    }
                    _ => false,
                }
            } else if request.method == "session/update" {
                acp::schema::SessionNotification::parse_message(&request.method, &request.params)
                    .is_ok()
            } else {
                false
            };
            if !valid {
                return Err(protected_input_error());
            }
        }
    }
    Ok(line)
}

fn protected_input_error() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        "protected ACP input was malformed",
    )
}

#[cfg(test)]
mod tests {
    use super::{
        connection_error_detail, project_protected_response, validate_protected_incoming_line,
        ProviderResponsePolicy,
    };
    use crate::live::sessions::driver::frame_observer::{ForkWireResponse, FrameObserver};
    use crate::live::sessions::driver::frame_tee::{log_frame, FrameDirection};

    #[test]
    fn protected_connection_error_omits_provider_message_and_data() {
        let error = agent_client_protocol::Error::invalid_params()
            .data(serde_json::json!({"sessionId": "provider-secret"}));
        assert!(error.to_string().contains("provider-secret"));
        assert!(
            connection_error_detail(&error, ProviderResponsePolicy::ProcessLocalFork).is_none()
        );
        assert!(
            connection_error_detail(&error, ProviderResponsePolicy::Ordinary)
                .is_some_and(|detail| detail.contains("provider-secret"))
        );
    }

    #[test]
    fn protected_preflight_rejects_malformed_input_without_raw_line() {
        let observer = FrameObserver::default();
        let sentinel = r#"{"jsonrpc":"2.0","id":{"provider-secret":true}"}"#.to_string();
        assert_eq!(
            validate_protected_incoming_line(&observer, sentinel.clone()).expect("ordinary input"),
            sentinel
        );

        observer.protect_process_local_fork();
        let error = validate_protected_incoming_line(&observer, sentinel)
            .expect_err("protected malformed input must fail closed");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(error.to_string(), "protected ACP input was malformed");
        assert!(!error.to_string().contains("provider-secret"));
    }

    #[test]
    fn protected_responder_projection_never_exposes_provider_error_data() {
        let error = agent_client_protocol::Error::invalid_params()
            .data(serde_json::json!({"provider-secret": true}));
        let projected = project_protected_response(
            Err::<serde_json::Value, _>(error),
            ProviderResponsePolicy::ProcessLocalFork,
            || serde_json::json!({"outcome": "cancelled"}),
        )
        .expect("protected response is a fixed success");
        let encoded = projected.to_string();
        assert_eq!(encoded, r#"{"outcome":"cancelled"}"#);
        assert!(!encoded.contains("provider-secret"));

        let ordinary = project_protected_response(
            Err::<serde_json::Value, _>(
                agent_client_protocol::Error::invalid_params()
                    .data(serde_json::json!({"provider-secret": true})),
            ),
            ProviderResponsePolicy::Ordinary,
            || serde_json::json!({}),
        )
        .expect_err("ordinary response preserves its error");
        assert!(ordinary.to_string().contains("provider-secret"));
    }

    #[test]
    fn protected_preflight_accepts_only_single_use_client_response_ids() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        log_frame(
            &observer,
            "product-child",
            FrameDirection::Send,
            r#"{"jsonrpc":"2.0","id":"known","method":"session/load"}"#,
        );

        let known = r#"{"jsonrpc":"2.0","id":"known","result":{}}"#.to_string();
        assert_eq!(
            validate_protected_incoming_line(&observer, known.clone()).expect("known response"),
            known
        );
        let duplicate = validate_protected_incoming_line(
            &observer,
            r#"{"jsonrpc":"2.0","id":"known","result":{}}"#.to_string(),
        )
        .expect_err("response IDs are single-use");
        assert_eq!(duplicate.to_string(), "protected ACP input was malformed");

        let unknown = validate_protected_incoming_line(
            &observer,
            r#"{"jsonrpc":"2.0","id":"provider-secret","result":{}}"#.to_string(),
        )
        .expect_err("unknown response id must fail closed");
        assert!(!unknown.to_string().contains("provider-secret"));
        let missing = validate_protected_incoming_line(
            &observer,
            r#"{"jsonrpc":"2.0","result":{}}"#.to_string(),
        )
        .expect_err("missing response id must fail closed");
        assert_eq!(missing.to_string(), "protected ACP input was malformed");
    }

    #[test]
    fn protected_preflight_rejects_typed_parse_failures_with_fixed_text() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        for line in [
            r#"{"jsonrpc":"2.0","id":"permission-secret","method":"session/request_permission","params":{"provider-secret":true}}"#,
            r#"{"jsonrpc":"2.0","id":"terminal-secret","method":"terminal/create","params":{"provider-secret":true}}"#,
            r#"{"jsonrpc":"2.0","id":"unknown-secret","method":"provider/private-method","params":{"provider-secret":true}}"#,
        ] {
            let error = validate_protected_incoming_line(&observer, line.to_string())
                .expect_err("malformed typed request must fail before ACP dispatch");
            assert_eq!(error.to_string(), "protected ACP input was malformed");
            assert!(!error.to_string().contains("provider-secret"));
        }

        let extension = r#"{"jsonrpc":"2.0","id":"ext-secret","method":"_experimental/provider/private","params":{"provider-secret":true}}"#.to_string();
        assert_eq!(
            validate_protected_incoming_line(&observer, extension.clone())
                .expect("opaque extension params remain unparsed"),
            extension
        );

        let notification = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"child","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"provider-secret"}}}}"#.to_string();
        assert_eq!(
            validate_protected_incoming_line(&observer, notification.clone())
                .expect("typed session notification"),
            notification
        );
        let malformed_notification =
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"provider-secret":true}}"#
                .to_string();
        let error = validate_protected_incoming_line(&observer, malformed_notification)
            .expect_err("malformed notification must fail before ACP dispatch");
        assert_eq!(error.to_string(), "protected ACP input was malformed");
    }

    #[test]
    fn protected_preflight_rejects_known_both_fields_after_fork_classifier() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        log_frame(
            &observer,
            "product-child",
            FrameDirection::Send,
            r#"{"jsonrpc":"2.0","id":9,"method":"session/fork"}"#,
        );
        let both_fields = r#"{"jsonrpc":"2.0","id":9,"result":{"sessionId":"child"},"error":{"code":-1,"message":"provider-secret"}}"#;
        log_frame(
            &observer,
            "product-child",
            FrameDirection::Recv,
            both_fields,
        );

        let error = validate_protected_incoming_line(&observer, both_fields.to_string())
            .expect_err("known malformed envelope fails after raw classification");
        assert_eq!(error.to_string(), "protected ACP input was malformed");
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::MalformedEnvelope
        );
    }
}

#[cfg(test)]
#[path = "connection_response_tests.rs"]
mod response_tests;
