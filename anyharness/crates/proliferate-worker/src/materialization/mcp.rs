use std::path::Path;

use serde_json::Value;

use crate::error::WorkerError;

use super::files::write_file;

pub fn write_mcp_materialization(
    workspace_root: &Path,
    mcp: Option<&Value>,
) -> Result<bool, WorkerError> {
    let Some(mcp) = mcp else {
        return Ok(false);
    };
    let contents = serde_json::to_vec_pretty(mcp)?;
    write_file(
        &workspace_root
            .join(".proliferate")
            .join("mcp")
            .join("materialization.json"),
        &contents,
        true,
    )?;
    Ok(true)
}
