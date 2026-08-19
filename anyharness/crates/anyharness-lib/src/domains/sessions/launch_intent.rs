use std::collections::BTreeMap;

/// The immutable, exactly validated configuration requested for one session.
/// It is persisted with the session row and is never reconstructed from legacy
/// session columns or product defaults.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolvedLaunchIntent {
    pub model_id: Option<String>,
    pub control_values: BTreeMap<String, String>,
    pub created_at: String,
}
