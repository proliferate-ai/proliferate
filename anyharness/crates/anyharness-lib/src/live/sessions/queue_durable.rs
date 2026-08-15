use crate::domains::sessions::model::PendingPromptRecord;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PendingPromptUpdateOutcome {
    Updated,
    NotFound,
    Protected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PendingPromptDeleteOutcome {
    Deleted(PendingPromptRecord),
    NotFound,
    Protected,
}
