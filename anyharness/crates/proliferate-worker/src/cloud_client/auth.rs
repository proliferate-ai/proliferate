use reqwest::RequestBuilder;

use crate::identity::StoredIdentity;

#[derive(Debug, Clone)]
pub struct WorkerAuth {
    pub target_id: String,
    pub worker_id: String,
    pub bearer_token: String,
}

impl WorkerAuth {
    pub fn from_identity(identity: &StoredIdentity) -> Option<Self> {
        identity.bearer_token().map(|token| Self {
            target_id: identity.target_id.clone(),
            worker_id: identity.worker_id.clone(),
            bearer_token: token.to_string(),
        })
    }

    pub fn apply(&self, request: RequestBuilder) -> RequestBuilder {
        request
            .bearer_auth(&self.bearer_token)
            .header("x-proliferate-target-id", &self.target_id)
            .header("x-proliferate-worker-id", &self.worker_id)
    }
}
