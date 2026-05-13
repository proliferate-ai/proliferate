use crate::error::Result;

pub async fn request_restart(_component: &str) -> Result<()> {
    tracing::info!("supervisor restart request is not implemented in the V1 worker skeleton");
    Ok(())
}
