use std::sync::Arc;

use agent_client_protocol as acp;
use tokio::sync::oneshot;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::live::sessions::driver::inbound::InboundDoor;

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

    let transport = acp::ByteStreams::new(stdin.compat_write(), stdout.compat());

    let client_for_notif = client.clone();
    let client_for_perm = client.clone();
    let client_for_ext = client.clone();
    let client_for_elicitation = client.clone();

    let connect_future = acp::Client
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
                responder.respond_with_result(result)
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: acp::schema::CreateElicitationRequest,
                        responder: acp::Responder<acp::schema::CreateElicitationResponse>,
                        _cx| {
                let result = client_for_elicitation.standard_mcp_elicitation(req).await;
                responder.respond_with_result(result)
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: acp::AgentRequest,
                        responder: acp::Responder<serde_json::Value>,
                        _cx| {
                match req {
                    acp::AgentRequest::ExtMethodRequest(ext_req) => {
                        let result = client_for_ext.handle_ext_request(ext_req).await;
                        match result {
                            Ok(ext_resp) => {
                                let json = serde_json::to_value(&ext_resp.0).map_err(|e| {
                                    acp::Error::internal_error().data(e.to_string())
                                })?;
                                responder.respond(json)
                            }
                            Err(e) => Err(e),
                        }
                    }
                    _ => Err(acp::Error::method_not_found()),
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
        if let Err(e) = connect_future.await {
            tracing::warn!(error = %e, "ACP connection ended");
        }
    });

    let conn = cx_rx
        .await
        .map_err(|_| anyhow::anyhow!("ACP connection closed before sending context"))?;
    Ok((conn, shutdown_tx))
}
