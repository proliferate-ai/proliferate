use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CheckoutPathLockKey {
    Canonical(PathBuf),
    StoredNormalized(String),
}

#[derive(Debug, Default)]
pub struct CheckoutDeletionGate {
    locked: Mutex<HashSet<CheckoutPathLockKey>>,
}

pub struct CheckoutDeletionLease {
    gate: Arc<CheckoutDeletionGate>,
    key: CheckoutPathLockKey,
}

impl CheckoutDeletionGate {
    pub fn new() -> Self {
        Self {
            locked: Mutex::new(HashSet::new()),
        }
    }

    pub fn try_acquire(
        self: &Arc<Self>,
        key: CheckoutPathLockKey,
    ) -> Option<CheckoutDeletionLease> {
        let mut locked = self.locked.lock().expect("checkout deletion gate poisoned");
        if locked.contains(&key) {
            return None;
        }
        locked.insert(key.clone());
        drop(locked);
        Some(CheckoutDeletionLease {
            gate: self.clone(),
            key,
        })
    }
}

impl Drop for CheckoutDeletionLease {
    fn drop(&mut self) {
        let mut locked = self
            .gate
            .locked
            .lock()
            .expect("checkout deletion gate poisoned");
        locked.remove(&self.key);
    }
}
