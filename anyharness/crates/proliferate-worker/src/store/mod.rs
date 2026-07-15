use std::path::PathBuf;

mod anyharness_update;
mod connection;
mod identity;
mod migrations;

pub struct WorkerStore {
    path: PathBuf,
}

impl Clone for WorkerStore {
    fn clone(&self) -> Self {
        Self {
            path: self.path.clone(),
        }
    }
}
