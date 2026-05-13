#[derive(Clone)]
pub struct StoredIdentity {
    pub target_id: String,
    pub worker_id: String,
    pub install_id: String,
    pub cloud_base_url: String,
    pub credential_kind: String,
    pub credential_value: String,
}

impl std::fmt::Debug for StoredIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredIdentity")
            .field("target_id", &self.target_id)
            .field("worker_id", &self.worker_id)
            .field("install_id", &self.install_id)
            .field("cloud_base_url", &self.cloud_base_url)
            .field("credential_kind", &self.credential_kind)
            .field("credential_value", &"<redacted>")
            .finish()
    }
}

impl StoredIdentity {
    pub fn bearer_token(&self) -> Option<&str> {
        (self.credential_kind == "bearer").then_some(self.credential_value.as_str())
    }
}
