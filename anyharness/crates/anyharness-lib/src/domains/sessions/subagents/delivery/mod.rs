//! Durable terminal-completion capture and eventual parent delivery.

pub use crate::domains::sessions::store::completion_deliveries::{
    CaptureCompletionDeliveryInput, CaptureCompletionDeliveryOutcome, CompletionDeliveryRecord,
    CompletionDeliveryState, CompletionDeliveryStore,
};
