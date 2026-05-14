use std::path::Path;

use serde_json::Value;

use crate::error::WorkerError;

use super::files::write_file;

pub fn write_skill_refs(workspace_root: &Path, skills: &[Value]) -> Result<bool, WorkerError> {
    if skills.is_empty() {
        return Ok(false);
    }
    let contents = serde_json::to_vec_pretty(skills)?;
    write_file(
        &workspace_root
            .join(".proliferate")
            .join("skills")
            .join("refs.json"),
        &contents,
        false,
    )?;
    Ok(true)
}
