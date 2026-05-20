use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::domains::plugins::SessionPluginBundle;

#[derive(Clone, Default)]
pub struct PluginBundleRegistry {
    inner: Arc<RwLock<HashMap<String, SessionPluginBundle>>>,
}

impl PluginBundleRegistry {
    pub fn set_session_bundle(&self, session_id: impl Into<String>, bundle: SessionPluginBundle) {
        self.inner
            .write()
            .expect("plugin bundle registry poisoned")
            .insert(session_id.into(), bundle);
    }

    pub fn get_session_bundle(&self, session_id: &str) -> Option<SessionPluginBundle> {
        self.inner
            .read()
            .expect("plugin bundle registry poisoned")
            .get(session_id)
            .cloned()
    }

    pub fn clear_session_bundle(&self, session_id: &str) {
        self.inner
            .write()
            .expect("plugin bundle registry poisoned")
            .remove(session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::PluginBundleRegistry;
    use crate::domains::plugins::SessionPluginBundle;

    #[test]
    fn set_get_and_clear_session_bundle() {
        let registry = PluginBundleRegistry::default();
        let bundle = SessionPluginBundle {
            plugins: Vec::new(),
        };

        registry.set_session_bundle("session-1", bundle.clone());
        assert_eq!(registry.get_session_bundle("session-1"), Some(bundle));

        registry.clear_session_bundle("session-1");
        assert_eq!(registry.get_session_bundle("session-1"), None);
    }
}
