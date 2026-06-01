use super::*;
use acp::Agent as _;
pub(in crate::live::sessions) async fn close_native_session(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    supports_close: bool,
) -> anyhow::Result<()> {
    if !supports_close {
        anyhow::bail!("agent does not advertise ACP session/close");
    }
    conn.close_session(acp::CloseSessionRequest::new(native_session_id.to_string()))
        .await
        .map(|_| ())
        .map_err(|error| anyhow::anyhow!("{error}"))
}
