use crate::{error::WorkerError, store::WorkerStore};

#[derive(Debug, Clone)]
pub struct WorkerIdentity {
    pub target_id: String,
    pub sandbox_profile_id: Option<String>,
    pub worker_id: String,
    pub worker_token: String,
}

impl WorkerIdentity {
    pub fn load(store: &WorkerStore) -> Result<Option<Self>, WorkerError> {
        store.load_identity()
    }

    pub fn save(&self, store: &WorkerStore) -> Result<(), WorkerError> {
        store.save_identity(self)
    }
}
