use std::path::Path;

use super::operations::run;
use super::types::{ProcessServiceError, RunProcessRequest, RunProcessResult};

pub struct ProcessService;

impl ProcessService {
    pub fn new() -> Self {
        Self
    }

    pub async fn run_command(
        &self,
        workspace_path: &Path,
        request: RunProcessRequest,
    ) -> Result<RunProcessResult, ProcessServiceError> {
        run::run_command(workspace_path, request).await
    }
}
