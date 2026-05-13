use crate::error::Result;

pub async fn stage_desired_artifact(_component: &str, _version: &str) -> Result<Option<String>> {
    Ok(None)
}
