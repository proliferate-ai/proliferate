use agent_client_protocol as acp;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::domains::sessions::live_config::{LegacyModeOption, LegacyModeState};
use crate::live::sessions::actor::config::apply::{
    apply_mode_via_direct_setter_legacy, apply_model_via_direct_setter,
    confirmed_mode_id_from_meta, confirmed_model_id_from_ext_response,
};
use crate::live::sessions::actor::config::types::ConfigApplyOutcome;
use crate::live::sessions::actor::state::SessionStartupState;

type DuplexRead = tokio::io::ReadHalf<tokio::io::DuplexStream>;
type DuplexWrite = tokio::io::WriteHalf<tokio::io::DuplexStream>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacySetModelRequest {
    session_id: String,
    model_id: String,
}

impl acp::JsonRpcMessage for LegacySetModelRequest {
    fn matches_method(method: &str) -> bool {
        method == "session/set_model"
    }

    fn method(&self) -> &'static str {
        "session/set_model"
    }

    fn to_untyped_message(&self) -> Result<acp::UntypedMessage, acp::Error> {
        acp::UntypedMessage::new(self.method(), self)
    }

    fn parse_message(
        method: &str,
        params: &impl Serialize,
    ) -> Result<Self, acp::Error> {
        if !Self::matches_method(method) {
            return Err(acp::Error::method_not_found());
        }
        acp::util::json_cast(params)
    }
}

impl acp::JsonRpcRequest for LegacySetModelRequest {
    type Response = serde_json::Value;
}

pub(super) struct FakeAcpConnection {
    pub(super) conn: acp::ConnectionTo<acp::Agent>,
    _client_shutdown: oneshot::Sender<()>,
    _agent_shutdown: oneshot::Sender<()>,
}

pub(super) async fn fake_connection(response: serde_json::Value) -> FakeAcpConnection {
    let (client_io, agent_io) = tokio::io::duplex(64 * 1024);
    let (client_read, client_write) = tokio::io::split(client_io);
    let (agent_read, agent_write) = tokio::io::split(agent_io);
    let (conn, client_shutdown) = establish_test_client(client_write, client_read).await;
    let agent_shutdown = spawn_fake_agent(agent_write, agent_read, response);
    FakeAcpConnection {
        conn,
        _client_shutdown: client_shutdown,
        _agent_shutdown: agent_shutdown,
    }
}

async fn establish_test_client(
    write: DuplexWrite,
    read: DuplexRead,
) -> (acp::ConnectionTo<acp::Agent>, oneshot::Sender<()>) {
    let (cx_tx, cx_rx) = oneshot::channel::<acp::ConnectionTo<acp::Agent>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let transport = acp::ByteStreams::new(write.compat_write(), read.compat());
    let connect_future = acp::Client.builder().connect_with(
        transport,
        move |cx: acp::ConnectionTo<acp::Agent>| async move {
            let _ = cx_tx.send(cx);
            let _ = shutdown_rx.await;
            Ok(())
        },
    );

    tokio::task::spawn_local(async move {
        let _ = connect_future.await;
    });

    let conn = cx_rx.await.expect("client ACP connection established");
    (conn, shutdown_tx)
}

fn spawn_fake_agent(
    write: DuplexWrite,
    read: DuplexRead,
    response: serde_json::Value,
) -> oneshot::Sender<()> {
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let transport = acp::ByteStreams::new(write.compat_write(), read.compat());
    let model_response = response.clone();
    let connect_future = acp::Agent
        .builder()
        .name("direct-setter-confirmation-fake-agent")
        .on_receive_request(
            async move |request: LegacySetModelRequest,
                        responder: acp::Responder<serde_json::Value>,
                        _cx| {
                assert_eq!(request.session_id, "native-1");
                assert_eq!(request.model_id, "grok-4.5");
                responder.respond(model_response.clone())
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |_req: acp::ClientRequest,
                        responder: acp::Responder<serde_json::Value>,
                        _cx| { responder.respond(response.clone()) },
            acp::on_receive_request!(),
        )
        .connect_with(
            transport,
            move |_cx: acp::ConnectionTo<acp::Client>| async move {
                let _ = shutdown_rx.await;
                Ok(())
            },
        );

    tokio::task::spawn_local(async move {
        let _ = connect_future.await;
    });
    shutdown_tx
}

fn empty_direct_model_state() -> SessionStartupState {
    SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: Default::default(),
    }
}

fn legacy_mode_state() -> SessionStartupState {
    SessionStartupState {
        current_mode_id: Some("ask".to_string()),
        legacy_mode_state: Some(LegacyModeState {
            current_mode_id: "ask".to_string(),
            available_modes: vec![
                LegacyModeOption {
                    id: "ask".to_string(),
                    name: "Ask".to_string(),
                    description: None,
                },
                LegacyModeOption {
                    id: "code".to_string(),
                    name: "Code".to_string(),
                    description: None,
                },
            ],
        }),
        config_options: Vec::new(),
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: Default::default(),
    }
}

#[test]
fn direct_setter_confirmation_requires_matching_agent_readback() {
    let confirmed_model = serde_json::json!({
        "_meta": { "model": { "Ok": "grok-4.5" } }
    });
    assert_eq!(
        confirmed_model_id_from_ext_response(&confirmed_model).as_deref(),
        Some("grok-4.5")
    );

    let mismatched_model = serde_json::json!({
        "_meta": { "model": { "Ok": "grok-4.6" } }
    });
    assert_ne!(
        confirmed_model_id_from_ext_response(&mismatched_model).as_deref(),
        Some("grok-4.5")
    );

    let acknowledgement_only = serde_json::json!({ "ok": true });
    assert_eq!(
        confirmed_model_id_from_ext_response(&acknowledgement_only),
        None
    );

    let mode_meta = serde_json::json!({ "mode": { "Ok": "agent-full-access" } })
        .as_object()
        .expect("mode metadata")
        .clone();
    assert_eq!(
        confirmed_mode_id_from_meta(Some(&mode_meta)).as_deref(),
        Some("agent-full-access")
    );
    let mismatched_mode = serde_json::json!({ "mode": { "Ok": "agent" } })
        .as_object()
        .expect("mismatched mode metadata")
        .clone();
    assert_ne!(
        confirmed_mode_id_from_meta(Some(&mismatched_mode)).as_deref(),
        Some("agent-full-access")
    );
    assert_eq!(confirmed_mode_id_from_meta(Some(&Default::default())), None);
}

#[tokio::test(flavor = "current_thread")]
async fn direct_model_setter_applies_only_matching_response_readback() {
    tokio::task::LocalSet::new()
        .run_until(async {
            let fake = fake_connection(serde_json::json!({
                "_meta": { "model": { "Ok": "grok-4.5" } }
            }))
            .await;
            let mut state = empty_direct_model_state();

            let outcome = apply_model_via_direct_setter(
                &fake.conn,
                "native-1",
                &mut state,
                "grok-4.5",
            )
            .await
            .expect("matching model readback");

            assert_eq!(outcome, ConfigApplyOutcome::AppliedAuthoritative);
            assert_eq!(state.current_model_id.as_deref(), Some("grok-4.5"));
        })
        .await;
}

#[tokio::test(flavor = "current_thread")]
async fn direct_model_setter_rejects_acknowledgement_and_mismatch_without_mutation() {
    tokio::task::LocalSet::new()
        .run_until(async {
            for response in [
                serde_json::json!({ "ok": true }),
                serde_json::json!({
                    "_meta": { "model": { "Ok": "grok-4.6" } }
                }),
            ] {
                let fake = fake_connection(response).await;
                let mut state = empty_direct_model_state();

                let outcome = apply_model_via_direct_setter(
                    &fake.conn,
                    "native-1",
                    &mut state,
                    "grok-4.5",
                )
                .await
                .expect("unconfirmed model response remains a handled refusal");

                assert_eq!(outcome, ConfigApplyOutcome::NotApplied);
                assert_eq!(state.current_model_id, None);
                assert!(state.config_options.is_empty());
            }
        })
        .await;
}

#[tokio::test(flavor = "current_thread")]
async fn legacy_mode_setter_applies_only_matching_response_readback() {
    tokio::task::LocalSet::new()
        .run_until(async {
            let fake = fake_connection(serde_json::json!({
                "_meta": { "mode": { "Ok": "code" } }
            }))
            .await;
            let mut state = legacy_mode_state();

            let outcome = apply_mode_via_direct_setter_legacy(
                &fake.conn,
                "native-1",
                &mut state,
                "code",
            )
            .await
            .expect("matching mode readback");

            assert_eq!(outcome, ConfigApplyOutcome::AppliedAuthoritative);
            assert_eq!(state.current_mode_id.as_deref(), Some("code"));
            assert_eq!(
                state
                    .legacy_mode_state
                    .as_ref()
                    .map(|mode| mode.current_mode_id.as_str()),
                Some("code")
            );
        })
        .await;
}

#[tokio::test(flavor = "current_thread")]
async fn legacy_mode_setter_rejects_acknowledgement_and_mismatch_without_mutation() {
    tokio::task::LocalSet::new()
        .run_until(async {
            for response in [
                serde_json::json!({ "ok": true }),
                serde_json::json!({
                    "_meta": { "mode": { "Ok": "ask" } }
                }),
            ] {
                let fake = fake_connection(response).await;
                let mut state = legacy_mode_state();

                let outcome = apply_mode_via_direct_setter_legacy(
                    &fake.conn,
                    "native-1",
                    &mut state,
                    "code",
                )
                .await
                .expect("unconfirmed mode response remains a handled refusal");

                assert_eq!(outcome, ConfigApplyOutcome::NotApplied);
                assert_eq!(state.current_mode_id.as_deref(), Some("ask"));
                assert_eq!(
                    state
                        .legacy_mode_state
                        .as_ref()
                        .map(|mode| mode.current_mode_id.as_str()),
                    Some("ask")
                );
                assert!(state.config_options.is_empty());
            }
        })
        .await;
}
