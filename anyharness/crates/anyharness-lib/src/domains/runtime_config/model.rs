use anyharness_contract::v1::TargetRuntimeConfigRefreshRequest;

#[derive(Debug, Clone)]
pub struct RuntimeConfigCurrentRecord {
    pub manifest: TargetRuntimeConfigRefreshRequest,
    pub applied_at: String,
}
