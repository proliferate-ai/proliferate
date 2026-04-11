use super::model::{CoworkRootRecord, CoworkThreadRecord};
use super::store::CoworkStore;

#[derive(Clone)]
pub struct CoworkService {
    store: CoworkStore,
}

impl CoworkService {
    pub fn new(store: CoworkStore) -> Self {
        Self { store }
    }

    pub fn get_root(&self) -> anyhow::Result<Option<CoworkRootRecord>> {
        self.store.get_root()
    }

    pub fn upsert_root(&self, repo_root_id: &str) -> anyhow::Result<CoworkRootRecord> {
        let existing = self.store.get_root()?;
        let now = chrono::Utc::now().to_rfc3339();
        let record = CoworkRootRecord {
            id: "cowork-root".to_string(),
            repo_root_id: repo_root_id.to_string(),
            created_at: existing
                .as_ref()
                .map(|value| value.created_at.clone())
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
        };
        self.store.upsert_root(&record)?;
        Ok(record)
    }

    pub fn create_thread(&self, record: CoworkThreadRecord) -> anyhow::Result<CoworkThreadRecord> {
        self.store.insert_thread(&record)?;
        Ok(record)
    }

    pub fn list_threads(&self) -> anyhow::Result<Vec<CoworkThreadRecord>> {
        self.store.list_threads()
    }
}
