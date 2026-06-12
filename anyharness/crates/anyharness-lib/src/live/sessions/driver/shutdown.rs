use super::*;
pub(in crate::live::sessions) async fn close_native_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    supports_close: bool,
) -> anyhow::Result<()> {
    if !supports_close {
        anyhow::bail!("agent does not advertise ACP session/close");
    }
    conn.send_request(acp::schema::CloseSessionRequest::new(
        native_session_id.to_string(),
    ))
    .block_task()
    .await
    .map(|_| ())
    .map_err(|error| anyhow::anyhow!("{error}"))
}
