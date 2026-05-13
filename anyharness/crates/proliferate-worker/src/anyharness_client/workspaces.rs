use serde_json::Value;

use crate::error::Result;

use super::AnyHarnessClient;

impl AnyHarnessClient {
    pub async fn list_workspaces(&self) -> Result<Value> {
        self.get_json("v1/workspaces").await
    }

    pub async fn get_workspace(&self, workspace_id: &str) -> Result<Value> {
        self.get_json(&format!("v1/workspaces/{workspace_id}"))
            .await
    }

    pub async fn retire_workspace_preflight(&self, workspace_id: &str) -> Result<Value> {
        self.get_json(&format!("v1/workspaces/{workspace_id}/retire/preflight"))
            .await
    }
}
